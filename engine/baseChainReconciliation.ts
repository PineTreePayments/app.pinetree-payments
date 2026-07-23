/**
 * PineTree Base Chain Reconciliation
 *
 * Canonical, single entry point for re-verifying a Base (ETH/USDC) payment
 * directly against the chain, regardless of the payment's current stored
 * status — including INCOMPLETE and FAILED, which the ordinary watcher path
 * (engine/checkPaymentOnce.ts) never re-checks once reached.
 *
 * This exists to close the exact gap that produced a live incident: a POS
 * terminal treated a WalletConnect request as expired/failed and the
 * merchant cancelled the payment (INCOMPLETE) before the engine ever learned
 * the customer's wallet had already submitted (and the chain later
 * confirmed) the real transaction.
 *
 * It reuses the SAME on-chain verification code every other payment uses
 * (engine/paymentWatcher.ts's watchPaymentOnce + engine/eventProcessor.ts's
 * processPaymentEvent) — there is no separate, ad hoc verification path here.
 * The only special behavior is passing `reconcile: true`, which allows a
 * verified match to repair an INCOMPLETE payment (engine/paymentReconciliation.ts)
 * instead of being silently skipped as terminal.
 *
 * Callers:
 *   - engine/paymentMaintenance.ts  (bounded automatic self-heal pass)
 *   - scripts/reconcile-base-payment.mjs  (manual/administrative repair)
 */

import { getPaymentById } from "@/database"
import { normalizeToStrictPaymentStatus } from "./paymentStateMachine"
import { buildBaseWatchInput } from "./checkPaymentOnce"
import { watchPaymentOnce } from "./paymentWatcher"
import { getTransactionByPaymentId } from "@/database/transactions"

export type BaseReconcileOutcome = {
  paymentId: string
  attempted: boolean
  detected: boolean
  previousStatus: string
  status: string
  reason: string
}

const MS_PER_BASE_BLOCK = 2_000
// Never scan further back than ~24h of Base blocks in one reconciliation call,
// even for a very old INCOMPLETE payment — keeps RPC cost bounded.
const MAX_LOOKBACK_BLOCKS = 43_200

function estimateLookbackBlocks(createdAt: string | null | undefined): number | undefined {
  const createdMs = new Date(String(createdAt || "")).getTime()
  if (!Number.isFinite(createdMs)) return undefined
  const elapsedMs = Date.now() - createdMs
  if (elapsedMs <= 0) return undefined
  // 1.5x buffer over the naive block-time estimate to absorb Base block-time
  // drift, then cap to the bound above.
  const estimated = Math.ceil((elapsedMs / MS_PER_BASE_BLOCK) * 1.5)
  return Math.min(MAX_LOOKBACK_BLOCKS, Math.max(estimated, 1))
}

/**
 * Re-verify a single Base payment against the chain and, if genuine payment
 * evidence is found, repair its canonical status through the standard
 * engine pipeline. Safe to call repeatedly (idempotent) and safe to call on
 * a payment that turns out to have no evidence (no-op).
 */
export async function reconcileBasePaymentFromChain(
  paymentId: string,
  options?: { timeoutMs?: number }
): Promise<BaseReconcileOutcome> {
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    return {
      paymentId,
      attempted: false,
      detected: false,
      previousStatus: "NOT_FOUND",
      status: "NOT_FOUND",
      reason: "payment_not_found"
    }
  }

  const previousStatus = normalizeToStrictPaymentStatus(payment.status)

  if (String(payment.network || "").toLowerCase() !== "base") {
    return { paymentId, attempted: false, detected: false, previousStatus, status: previousStatus, reason: "not_base_network" }
  }

  if (previousStatus === "CONFIRMED") {
    return { paymentId, attempted: false, detected: false, previousStatus, status: previousStatus, reason: "already_confirmed" }
  }

  const watchInput = buildBaseWatchInput(payment)
  if (!watchInput.merchantWallet || !watchInput.pinetreeWallet) {
    return { paymentId, attempted: false, detected: false, previousStatus, status: previousStatus, reason: "missing_split_metadata" }
  }

  const transaction = await getTransactionByPaymentId(paymentId)
  const txHash = String(transaction?.provider_transaction_id || "").trim() || undefined
  const lookbackOverride = estimateLookbackBlocks(payment.created_at)

  console.info("[baseChainReconciliation] reconcile started", {
    paymentId,
    previousStatus,
    feeCaptureMethod: watchInput.feeCaptureMethod || null,
    hasStoredTxHash: Boolean(txHash),
    lookbackOverride: lookbackOverride || null
  })

  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 8_000)
  let detected = false
  try {
    detected = await Promise.race([
      watchPaymentOnce({ ...watchInput, txHash, reconcile: true, lookbackOverride }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), timeoutMs)
      })
    ])
  } catch (error) {
    console.warn("[baseChainReconciliation] chain check failed", {
      paymentId,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  const refreshed = await getPaymentById(paymentId)
  const status = refreshed ? normalizeToStrictPaymentStatus(refreshed.status) : previousStatus

  console.info("[baseChainReconciliation] reconcile finished", {
    paymentId,
    previousStatus,
    status,
    detected
  })

  return {
    paymentId,
    attempted: true,
    detected,
    previousStatus,
    status,
    reason: detected ? "chain_evidence_found" : "no_chain_evidence_in_window"
  }
}
