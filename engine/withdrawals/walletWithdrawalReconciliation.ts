import {
  listProcessingWithdrawalsForReconciliation,
  listProcessingBitcoinWithdrawalsForReconciliation,
  updateWalletWithdrawalRequest,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { listProcessingWalletOperationsForReconciliation } from "@/database/merchantWalletOperations"
import { insertWithdrawalAuditEvent } from "@/database/merchantAuditEvents"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { getConnectedAccountSendStatus } from "@/providers/lightning/speedWalletManagement"
import { getWalletWithdrawal } from "@/engine/wallet/walletOperations"
import { syncPineTreeWalletBalances } from "@/engine/pineTreeWalletSync"

export type ReconciliationResult = {
  checked: number
  confirmed: number
  failed: number
  still_processing: number
  skipped: number
}

type OnChainStatus = "confirmed" | "failed" | "pending"

function maskReference(value: string | null | undefined) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  return normalized.length <= 16 ? normalized : `${normalized.slice(0, 8)}...${normalized.slice(-6)}`
}

function reconcileLog(event: string, details: Record<string, unknown>) {
  console.info(`[pinetree-withdrawals] ${event}`, details)
}

async function refreshBalancesAfterLifecycleChange(input: {
  merchantId: string
  rail: string
  asset: string
  status: string
  table: string
  id: string
}) {
  await syncPineTreeWalletBalances(input.merchantId).catch((error) => {
    console.warn("[pinetree-balances] withdrawal_reconcile_balance_sync_failed", {
      merchantId: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      status: input.status,
      table: input.table,
      id: input.id,
      error: error instanceof Error ? error.message : "unknown_error",
    })
  })
}

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

/**
 * Bitcoin/Lightning withdrawals executed via Speed's Instant Send have no
 * on-chain tx_hash to poll - status comes from Speed's own send object.
 * Only flips on an explicit signal (failure_reason present, or a known
 * terminal status string) - anything ambiguous stays "pending" rather than
 * guessing, matching this reconciler's existing conservative philosophy for
 * Base/Solana.
 */
const SPEED_SEND_SUCCESS_STATUSES = new Set(["paid", "confirmed", "completed", "sent"])
const SPEED_SEND_FAILURE_STATUSES = new Set(["failed", "expired", "canceled", "cancelled", "rejected"])

async function checkSpeedInstantSend(merchantId: string, providerSendId: string): Promise<OnChainStatus> {
  const profile = await getMerchantLightningProfile(merchantId).catch(() => null)
  const speedAccountId = String(profile?.speed_account_id || "").trim()
  if (!speedAccountId.startsWith("acct_")) return "pending"

  try {
    const send = await getConnectedAccountSendStatus({ merchantId, speedAccountId, providerSendId })
    if (send.failure_reason) return "failed"
    const status = String(send.status || "").trim().toLowerCase()
    if (SPEED_SEND_FAILURE_STATUSES.has(status)) return "failed"
    if (SPEED_SEND_SUCCESS_STATUSES.has(status)) return "confirmed"
    return "pending"
  } catch {
    return "pending"
  }
}

async function reconcileOne(
  withdrawal: WalletWithdrawalRequestRecord
): Promise<"confirmed" | "failed" | "pending" | "skipped"> {
  const { id, merchant_id, rail, asset, tx_hash, provider_reference } = withdrawal

  let onChainStatus: OnChainStatus
  const reference = String(tx_hash || provider_reference || "").trim()
  const details = {
    table: "wallet_withdrawal_requests",
    merchantId: merchant_id,
    withdrawalId: id,
    rail,
    asset,
    provider: withdrawal.provider,
    txHash: maskReference(tx_hash),
    providerReference: maskReference(provider_reference),
  }

  if (rail === "solana" && reference) {
    reconcileLog("WITHDRAWAL_RECONCILE_PROVIDER_LOOKUP_STARTED", {
      ...details,
      providerLookup: "solana_signature",
    })
    onChainStatus = await checkSolanaTransaction(reference)
  } else if (rail === "base" && reference) {
    reconcileLog("WITHDRAWAL_RECONCILE_PROVIDER_LOOKUP_STARTED", {
      ...details,
      providerLookup: "base_receipt",
    })
    onChainStatus = await checkBaseTransaction(reference)
  } else if (rail === "bitcoin" && provider_reference) {
    reconcileLog("WITHDRAWAL_RECONCILE_PROVIDER_LOOKUP_STARTED", {
      ...details,
      providerLookup: "speed_instant_send",
    })
    onChainStatus = await checkSpeedInstantSend(merchant_id, provider_reference)
  } else {
    reconcileLog("WITHDRAWAL_RECONCILE_SKIPPED", {
      ...details,
      reason: "missing_provider_reference",
    })
    return "skipped"
  }

  if (onChainStatus === "pending") {
    reconcileLog("WITHDRAWAL_RECONCILE_STILL_PROCESSING", {
      ...details,
      reason: "provider_pending",
    })
    return "pending"
  }

  const newStatus = onChainStatus === "confirmed" ? "confirmed" : "failed"
  const eventType = onChainStatus === "confirmed" ? "withdrawal.confirmed" : "withdrawal.failed"
  const now = new Date().toISOString()

  await updateWalletWithdrawalRequest(merchant_id, id, {
    status: newStatus,
    ...(newStatus === "confirmed"
      ? { confirmedAt: now, errorMessage: null, errorCode: null }
      : { failedAt: now, errorMessage: "Withdrawal failed on-chain.", errorCode: "CHAIN_TRANSACTION_FAILED" }),
  })

  await insertWithdrawalAuditEvent({
    merchantId: merchant_id,
    eventType,
    withdrawalId: id,
    rail,
    asset,
    status: newStatus,
    metadata: { tx_hash, provider_reference, reconciled_at: now },
  })

  console.log(`[reconcile-withdrawals] ${id} → ${newStatus} (${rail}/${asset} tx=${tx_hash || provider_reference})`)

  reconcileLog(onChainStatus === "confirmed" ? "WITHDRAWAL_RECONCILE_CONFIRMED" : "WITHDRAWAL_RECONCILE_FAILED", {
    ...details,
    status: newStatus,
  })
  await refreshBalancesAfterLifecycleChange({
    merchantId: merchant_id,
    rail,
    asset,
    status: newStatus,
    table: "wallet_withdrawal_requests",
    id,
  })
  return onChainStatus
}

/**
 * Reconciles Bitcoin/Speed withdrawals submitted through
 * engine/wallet/walletOperations.ts (merchant_wallet_operations) - the
 * table the live UI actually writes to for Bitcoin. Without this, those
 * rows had no reconciliation path at all: the cron above only ever queried
 * wallet_withdrawal_requests (a table Bitcoin withdrawals never write to),
 * and the webhook-based update path
 * (engine/wallet/speedWalletWebhookNormalizer.ts) only fires if Speed's
 * connected-account webhook happens to be subscribed to withdraw.* events,
 * which cannot be assumed. getWalletWithdrawal already resolves the exact
 * same merchant->Speed-account context used to create the withdrawal and
 * persists the result - this just needs to be called on a schedule.
 */
async function reconcileProcessingWalletOperations(limit: number, merchantId?: string): Promise<{
  checked: number
  confirmed: number
  failed: number
  still_processing: number
  skipped: number
}> {
  const operations = await listProcessingWalletOperationsForReconciliation(limit, merchantId)
  const result = { checked: operations.length, confirmed: 0, failed: 0, still_processing: 0, skipped: 0 }
  reconcileLog("WALLET_OPERATION_RECONCILE_SELECTED", {
    table: "merchant_wallet_operations",
    count: operations.length,
    limit,
    merchantScoped: Boolean(merchantId),
  })

  for (const operation of operations) {
    try {
      reconcileLog("WALLET_OPERATION_PROVIDER_LOOKUP_STARTED", {
        table: "merchant_wallet_operations",
        merchantId: operation.merchant_id,
        operationId: operation.id,
        provider: operation.provider,
        providerReference: maskReference(operation.provider_reference),
      })
      const updated = await getWalletWithdrawal(operation.merchant_id, operation.id)
      const statusNormalized = updated.status !== "PROCESSING"
      reconcileLog("WALLET_OPERATION_STATUS_NORMALIZED", {
        table: "merchant_wallet_operations",
        merchantId: operation.merchant_id,
        operationId: operation.id,
        persistedStatusBefore: "PROCESSING",
        providerStatus: updated.status,
        changed: statusNormalized,
      })
      if (updated.status === "COMPLETED") {
        result.confirmed++
        reconcileLog("CANONICAL_WALLET_STATUS_CONFLICT_DETECTED", {
          table: "merchant_wallet_operations",
          operationId: operation.id,
          linkedPaymentOrTransactionId: null,
          activityStatus: "processing",
          paymentStatus: null,
          providerStatus: "COMPLETED",
          chosenStatus: "confirmed",
          reason: "provider_confirmed_while_activity_still_processing",
        })
        reconcileLog("WALLET_OPERATION_CONFIRMED", {
          table: "merchant_wallet_operations",
          merchantId: operation.merchant_id,
          operationId: operation.id,
          provider: operation.provider,
        })
        reconcileLog("CANONICAL_WALLET_STATUS_CONFLICT_REPAIRED", {
          table: "merchant_wallet_operations",
          operationId: operation.id,
          chosenStatus: "confirmed",
          reason: "reconciled_from_provider_evidence",
        })
        await refreshBalancesAfterLifecycleChange({
          merchantId: operation.merchant_id,
          rail: "bitcoin",
          asset: "BTC",
          status: "confirmed",
          table: "merchant_wallet_operations",
          id: operation.id,
        })
      } else if (updated.status === "FAILED") {
        result.failed++
        reconcileLog("WALLET_OPERATION_FAILED", {
          table: "merchant_wallet_operations",
          merchantId: operation.merchant_id,
          operationId: operation.id,
          provider: operation.provider,
        })
        await refreshBalancesAfterLifecycleChange({
          merchantId: operation.merchant_id,
          rail: "bitcoin",
          asset: "BTC",
          status: "failed",
          table: "merchant_wallet_operations",
          id: operation.id,
        })
      } else {
        result.still_processing++
        reconcileLog("WALLET_OPERATION_STILL_PROCESSING", {
          table: "merchant_wallet_operations",
          merchantId: operation.merchant_id,
          operationId: operation.id,
          provider: operation.provider,
          status: updated.status,
        })
      }
      console.log(
        `[reconcile-withdrawals] wallet_operation ${operation.id} -> ${updated.status} (speed/BTC ref=${operation.provider_reference})`
      )
    } catch (error) {
      // A single merchant's provider/context failure (e.g. Speed account was
      // disconnected after the withdrawal was submitted) must never block
      // reconciliation of every other row in this batch.
      console.warn("[reconcile-withdrawals] wallet_operation reconciliation failed", {
        operationId: operation.id,
        merchantId: operation.merchant_id,
        error: error instanceof Error ? error.message : String(error),
      })
      reconcileLog("WALLET_OPERATION_RECONCILE_SKIPPED", {
        table: "merchant_wallet_operations",
        merchantId: operation.merchant_id,
        operationId: operation.id,
        reason: "provider_lookup_failed",
      })
      result.skipped++
    }
  }

  return result
}

export async function reconcileProcessingWithdrawals(options: {
  limit?: number
  /**
   * When provided, scopes every underlying reconciliation query to a single
   * merchant so this can be safely awaited inline on a request path (e.g.
   * the PineTree Wallet sync route) without paying for or blocking on other
   * merchants' processing rows. Omit for the global background sweep.
   */
  merchantId?: string
}): Promise<ReconciliationResult> {
  const limit = options.limit ?? 50
  const merchantId = options.merchantId
  const [onChainWithdrawals, bitcoinWithdrawals, walletOperations] = await Promise.all([
    listProcessingWithdrawalsForReconciliation(limit, merchantId),
    listProcessingBitcoinWithdrawalsForReconciliation(limit, merchantId),
    reconcileProcessingWalletOperations(limit, merchantId),
  ])
  const withdrawals = [...onChainWithdrawals, ...bitcoinWithdrawals]
  reconcileLog("WITHDRAWAL_RECONCILE_SELECTED", {
    table: "wallet_withdrawal_requests",
    dynamicCount: onChainWithdrawals.length,
    bitcoinCount: bitcoinWithdrawals.length,
    total: withdrawals.length,
    limit,
    merchantScoped: Boolean(merchantId),
  })

  const result: ReconciliationResult = {
    checked: withdrawals.length + walletOperations.checked,
    confirmed: walletOperations.confirmed,
    failed: walletOperations.failed,
    still_processing: walletOperations.still_processing,
    skipped: walletOperations.skipped,
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
