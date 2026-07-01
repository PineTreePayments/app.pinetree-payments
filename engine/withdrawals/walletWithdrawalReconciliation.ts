import {
  listProcessingWithdrawalsForReconciliation,
  updateWalletWithdrawalRequest,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { insertWithdrawalAuditEvent } from "@/database/merchantAuditEvents"

export type ReconciliationResult = {
  checked: number
  confirmed: number
  failed: number
  still_processing: number
  skipped: number
}

type OnChainStatus = "confirmed" | "failed" | "pending"

function getSolanaRpcUrls(): string[] {
  return [
    process.env.RPC_URL_SOLANA,
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ].filter(Boolean) as string[]
}

async function checkSolanaTransaction(txHash: string): Promise<OnChainStatus> {
  const rpcUrls = getSolanaRpcUrls()

  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[txHash], { searchTransactionHistory: true }],
        }),
        cache: "no-store",
      })
      const payload = (await res.json()) as {
        error?: unknown
        result?: { value: Array<{ confirmationStatus?: string; err: unknown } | null> | null }
      }
      if (payload.error) continue

      const statusList = payload.result?.value
      if (!statusList || statusList.length === 0) return "pending"

      const status = statusList[0]
      if (!status) return "pending"
      if (status.err != null) return "failed"

      const cs = status.confirmationStatus
      if (cs === "confirmed" || cs === "finalized") return "confirmed"

      return "pending"
    } catch {
      // try next endpoint
    }
  }

  return "pending"
}

async function checkBaseTransaction(txHash: string): Promise<OnChainStatus> {
  const rpcUrl = String(process.env.BASE_RPC_URL || "").trim()
  if (!rpcUrl) {
    console.warn("[reconcile-withdrawals] BASE_RPC_URL not set; skipping Base tx check for", txHash)
    return "pending"
  }

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      cache: "no-store",
    })
    const payload = (await res.json()) as {
      error?: unknown
      result?: { status: string } | null
    }
    if (payload.error) return "pending"

    const receipt = payload.result
    if (!receipt) return "pending"
    if (receipt.status === "0x1") return "confirmed"
    if (receipt.status === "0x0") return "failed"

    return "pending"
  } catch {
    return "pending"
  }
}

async function reconcileOne(
  withdrawal: WalletWithdrawalRequestRecord
): Promise<"confirmed" | "failed" | "pending" | "skipped"> {
  const { id, merchant_id, rail, asset, tx_hash } = withdrawal
  if (!tx_hash) return "skipped"

  let onChainStatus: OnChainStatus

  if (rail === "solana") {
    onChainStatus = await checkSolanaTransaction(tx_hash)
  } else if (rail === "base") {
    onChainStatus = await checkBaseTransaction(tx_hash)
  } else {
    // Bitcoin not handled in this pass
    return "skipped"
  }

  if (onChainStatus === "pending") return "pending"

  const newStatus = onChainStatus === "confirmed" ? "confirmed" : "failed"
  const eventType = onChainStatus === "confirmed" ? "withdrawal.confirmed" : "withdrawal.failed"

  await updateWalletWithdrawalRequest(merchant_id, id, { status: newStatus })

  await insertWithdrawalAuditEvent({
    merchantId: merchant_id,
    eventType,
    withdrawalId: id,
    rail,
    asset,
    status: newStatus,
    metadata: { tx_hash },
  })

  console.log(`[reconcile-withdrawals] ${id} → ${newStatus} (${rail}/${asset} tx=${tx_hash})`)

  return onChainStatus
}

export async function reconcileProcessingWithdrawals(options: {
  limit?: number
}): Promise<ReconciliationResult> {
  const limit = options.limit ?? 50
  const withdrawals = await listProcessingWithdrawalsForReconciliation(limit)

  const result: ReconciliationResult = {
    checked: withdrawals.length,
    confirmed: 0,
    failed: 0,
    still_processing: 0,
    skipped: 0,
  }

  for (const withdrawal of withdrawals) {
    const outcome = await reconcileOne(withdrawal)
    if (outcome === "confirmed") result.confirmed++
    else if (outcome === "failed") result.failed++
    else if (outcome === "pending") result.still_processing++
    else result.skipped++
  }

  console.log("[reconcile-withdrawals] complete", result)
  return result
}
