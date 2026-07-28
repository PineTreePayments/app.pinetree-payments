/**
 * Chain-evidence recovery for Dynamic-signed Base/Solana withdrawals whose
 * signed transaction was broadcast by the browser but whose completion call
 * (POST /api/wallets/pinetree-wallet/withdrawals/[id]/submit ->
 * completeDynamicWalletWithdrawal) never persisted the hash.
 *
 * Root cause this closes (production incident, withdrawal
 * b591c14b-b97f-4ef5-9e38-8d8d31b2c311): between Dynamic signing (funds
 * already broadcast on-chain) and the /submit POST, the transaction hash
 * exists ONLY in browser memory. If that POST never lands (tab killed,
 * mobile hand-off, network drop), the canonical row stays status="pending"
 * with no tx_hash/provider_reference - and every reconciler only scans
 * status="processing" rows, so nothing server-side could EVER advance it.
 * The UI then truthfully projects "Waiting" forever while the destination
 * wallet already holds the funds.
 *
 * This module gives the Engine an authoritative, browser-independent path to
 * the missing pending -> processing transition: scan the chain for a
 * transaction that exactly matches the prepared payload (source, destination,
 * asset, amount, success) and adopt it as provider evidence. Adoption is
 * strictly conservative - only an exact, successful match is adopted; any
 * ambiguity leaves the row untouched for the next pass. SUBMITTED evidence
 * (submitted_at) is taken from the chain block time, never invented.
 *
 * The existing processing reconciler (walletWithdrawalReconciliation.ts)
 * then advances the adopted row to CONFIRMED under the normal rail-specific
 * confirmation rule - this module deliberately does not skip that step.
 */

import { getAssociatedTokenAddress } from "@solana/spl-token"
import { PublicKey } from "@solana/web3.js"
import { parseEther, parseUnits } from "viem"
import {
  listPendingDynamicWithdrawalsForRecovery,
  updateWalletWithdrawalRequest,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { insertWithdrawalAuditEvent } from "@/database/merchantAuditEvents"
import {
  BASE_USDC_TOKEN_ADDRESS,
  SOLANA_USDC_MINT,
} from "@/engine/withdrawals/walletWithdrawals"

export type PendingRecoveryResult = {
  candidates: number
  recovered: number
  unmatched: number
  errors: number
}

/** Clock-skew allowance when comparing chain block time to row creation. */
const BLOCK_TIME_SKEW_MS = 2 * 60 * 1000
const SOLANA_SIGNATURE_SCAN_LIMIT = 30

function getSolanaRpcUrl(): string {
  return (
    process.env.RPC_URL_SOLANA ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  )
}

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  })
  const payload = (await res.json()) as { error?: { message?: string }; result?: unknown }
  if (payload.error) throw new Error(`${method} failed: ${payload.error.message || "rpc error"}`)
  return payload.result
}

function parseDecimalToBaseUnits(amountDecimal: string, decimals: number): bigint | null {
  const raw = String(amountDecimal || "").trim()
  const normalized = raw.startsWith(".") ? `0${raw}` : raw
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const [whole, fraction = ""] = normalized.split(".")
  if (fraction.length > decimals) return null
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")
}

type AdoptedEvidence = {
  txHash: string
  /** ISO timestamp of the chain block - real evidence, never invented. */
  submittedAt: string
}

// ---------------------------------------------------------------------------
// Solana matching
// ---------------------------------------------------------------------------

type SolanaSignatureInfo = { signature: string; blockTime: number | null; err: unknown }

type ParsedSolanaInstruction = {
  program?: string
  parsed?: {
    type?: string
    info?: {
      source?: string
      destination?: string
      lamports?: number | string
      authority?: string
      multisigAuthority?: string
      amount?: string
      mint?: string
      tokenAmount?: { amount?: string }
    }
  }
}

async function findSolanaEvidence(
  request: WalletWithdrawalRequestRecord,
  sourceAddress: string
): Promise<AdoptedEvidence | null> {
  const rpcUrl = getSolanaRpcUrl()
  const createdAtMs = new Date(request.created_at).getTime()
  const signatures = (await jsonRpc(rpcUrl, "getSignaturesForAddress", [
    sourceAddress,
    { limit: SOLANA_SIGNATURE_SCAN_LIMIT },
  ])) as SolanaSignatureInfo[] | null
  if (!Array.isArray(signatures)) return null

  const expectedUnits =
    request.asset === "SOL"
      ? parseDecimalToBaseUnits(request.amount_decimal, 9)
      : parseDecimalToBaseUnits(request.amount_decimal, 6)
  if (expectedUnits === null) return null

  const expectedDestinationAta =
    request.asset === "USDC"
      ? (
          await getAssociatedTokenAddress(
            new PublicKey(SOLANA_USDC_MINT),
            new PublicKey(request.destination_address)
          )
        ).toBase58()
      : null

  for (const sig of signatures) {
    if (sig.err != null) continue
    if (!sig.blockTime || sig.blockTime * 1000 < createdAtMs - BLOCK_TIME_SKEW_MS) continue

    const tx = (await jsonRpc(rpcUrl, "getTransaction", [
      sig.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ])) as {
      meta?: { err?: unknown } | null
      transaction?: { message?: { instructions?: ParsedSolanaInstruction[] } }
    } | null
    if (!tx || tx.meta?.err != null) continue

    for (const instruction of tx.transaction?.message?.instructions || []) {
      const parsed = instruction.parsed
      const info = parsed?.info
      if (!parsed || !info) continue

      if (request.asset === "SOL") {
        if (instruction.program !== "system" || parsed.type !== "transfer") continue
        if (info.source !== sourceAddress) continue
        if (info.destination !== request.destination_address) continue
        if (BigInt(String(info.lamports ?? "0")) !== expectedUnits) continue
      } else {
        if (instruction.program !== "spl-token") continue
        if (!["transfer", "transferChecked"].includes(String(parsed.type))) continue
        const authority = info.authority || info.multisigAuthority
        if (authority !== sourceAddress) continue
        // transferChecked carries the mint explicitly; a plain transfer does
        // not, so for it the destination-ATA check below is the mint proof.
        if (parsed.type === "transferChecked" && info.mint !== SOLANA_USDC_MINT) continue
        if (info.destination !== expectedDestinationAta) continue
        const amount = info.tokenAmount?.amount ?? info.amount
        if (BigInt(String(amount ?? "0")) !== expectedUnits) continue
      }

      return {
        txHash: sig.signature,
        submittedAt: new Date(sig.blockTime * 1000).toISOString(),
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Base matching
// ---------------------------------------------------------------------------

type AlchemyAssetTransfer = {
  hash?: string
  from?: string
  to?: string
  rawContract?: { value?: string; address?: string | null }
  metadata?: { blockTimestamp?: string }
}

/**
 * Uses Alchemy's alchemy_getAssetTransfers (BASE_RPC_URL is an Alchemy
 * endpoint in this deployment). If the RPC does not support the method, the
 * scan is skipped conservatively - no adoption without positive evidence.
 */
async function findBaseEvidence(
  request: WalletWithdrawalRequestRecord,
  sourceAddress: string
): Promise<AdoptedEvidence | null> {
  const rpcUrl = String(process.env.BASE_RPC_URL || "").trim()
  if (!rpcUrl) return null
  const createdAtMs = new Date(request.created_at).getTime()
  const isEth = request.asset === "ETH"
  const expectedUnits = isEth
    ? parseEther(request.amount_decimal)
    : parseUnits(request.amount_decimal, 6)

  const transfers = (await jsonRpc(rpcUrl, "alchemy_getAssetTransfers", [
    {
      fromAddress: sourceAddress,
      toAddress: request.destination_address,
      category: isEth ? ["external"] : ["erc20"],
      ...(isEth ? {} : { contractAddresses: [BASE_USDC_TOKEN_ADDRESS] }),
      withMetadata: true,
      order: "desc",
      maxCount: "0x19",
    },
  ])) as { transfers?: AlchemyAssetTransfer[] } | null

  for (const transfer of transfers?.transfers || []) {
    if (!transfer.hash) continue
    const blockTimestamp = transfer.metadata?.blockTimestamp
    const blockMs = blockTimestamp ? new Date(blockTimestamp).getTime() : NaN
    if (!Number.isFinite(blockMs) || blockMs < createdAtMs - BLOCK_TIME_SKEW_MS) continue
    const rawValue = transfer.rawContract?.value
    if (!rawValue) continue
    let value: bigint
    try {
      value = BigInt(rawValue)
    } catch {
      continue
    }
    if (value !== expectedUnits) continue

    // Adopt only a successful transaction - a reverted call moved no funds.
    const receipt = (await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [transfer.hash])) as {
      status?: string
    } | null
    if (!receipt || receipt.status !== "0x1") continue

    return { txHash: transfer.hash, submittedAt: new Date(blockMs).toISOString() }
  }
  return null
}

// ---------------------------------------------------------------------------
// Recovery driver
// ---------------------------------------------------------------------------

function preparedSourceAddress(request: WalletWithdrawalRequestRecord): string | null {
  const payload = request.unsigned_transaction_payload as { from?: unknown } | null
  const from = String(payload?.from || "").trim()
  return from || null
}

export async function recoverPendingDynamicWithdrawals(options: {
  limit?: number
  merchantId?: string
  /**
   * Targeted, client-triggered discovery for a single withdrawal the browser
   * is signing right now. Combined with minAgeMs 0 this bypasses the
   * background sweep's grace window, which exists only to avoid racing a live
   * /submit - an explicit request for this exact row has no such race.
   */
  withdrawalId?: string
  minAgeMs?: number
}): Promise<PendingRecoveryResult> {
  const limit = options.limit ?? 20
  const result: PendingRecoveryResult = { candidates: 0, recovered: 0, unmatched: 0, errors: 0 }

  let candidates: WalletWithdrawalRequestRecord[]
  try {
    candidates = await listPendingDynamicWithdrawalsForRecovery(
      limit,
      options.merchantId,
      options.minAgeMs,
      options.withdrawalId
    )
  } catch (error) {
    console.warn("[pinetree-withdrawals] PENDING_RECOVERY_LIST_FAILED", {
      error: error instanceof Error ? error.message : String(error),
    })
    result.errors += 1
    return result
  }
  result.candidates = candidates.length

  for (const request of candidates) {
    const details = {
      merchantId: request.merchant_id,
      withdrawalId: request.id,
      rail: request.rail,
      asset: request.asset,
    }
    try {
      const sourceAddress = preparedSourceAddress(request)
      if (!sourceAddress) {
        result.unmatched += 1
        continue
      }
      console.info("[pinetree-withdrawals] PENDING_RECOVERY_CHAIN_SCAN_STARTED", details)
      const evidence =
        request.rail === "solana"
          ? await findSolanaEvidence(request, sourceAddress)
          : await findBaseEvidence(request, sourceAddress)

      if (!evidence) {
        console.info("[pinetree-withdrawals] PENDING_RECOVERY_NO_MATCH", details)
        result.unmatched += 1
        continue
      }

      await updateWalletWithdrawalRequest(request.merchant_id, request.id, {
        status: "processing",
        provider: "dynamic",
        providerReference: evidence.txHash,
        txHash: evidence.txHash,
        errorMessage: null,
        errorCode: null,
        submittedAt: evidence.submittedAt,
      })
      void insertWithdrawalAuditEvent({
        merchantId: request.merchant_id,
        eventType: "withdrawal.processing",
        withdrawalId: request.id,
        rail: request.rail,
        asset: request.asset,
        status: "processing",
        metadata: {
          tx_hash: evidence.txHash,
          provider: "dynamic",
          submitted_at: evidence.submittedAt,
          recovered_from_chain: true,
        },
      })
      console.info("[pinetree-withdrawals] PENDING_RECOVERY_EVIDENCE_ADOPTED", {
        ...details,
        txHashSuffix: evidence.txHash.slice(-8),
        submittedAt: evidence.submittedAt,
      })
      result.recovered += 1
    } catch (error) {
      console.warn("[pinetree-withdrawals] PENDING_RECOVERY_FAILED", {
        ...details,
        error: error instanceof Error ? error.message : String(error),
      })
      result.errors += 1
    }
  }

  return result
}
