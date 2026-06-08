/**
 * Transaction reconciliation helper.
 *
 * Every time a payment reaches a terminal state the linked transaction row
 * must be updated to match.  This helper is the single authoritative
 * implementation of that mapping.
 *
 * Mapping:
 *   payment CONFIRMED  → transaction CONFIRMED   (always authoritative; overrides FAILED/INCOMPLETE)
 *   payment FAILED     → transaction FAILED       (only if non-terminal and no provider_transaction_id)
 *   payment INCOMPLETE → transaction INCOMPLETE   (only if non-terminal and no provider_transaction_id)
 *   payment EXPIRED    → transaction INCOMPLETE   (EXPIRED is not a first-class transaction state)
 *   payment CANCELLED  → transaction INCOMPLETE   (CANCELLED is not a first-class transaction state)
 *
 * Called from:
 *   - engine/updatePaymentStatus.ts  (all TypeScript payment terminal transitions)
 *   - SQL sweep function             (sweep marks payments INCOMPLETE → also updates transactions)
 *
 * The one-time backfill for already-diverged rows is in
 * scripts/reconcile-transactions-backfill.sql.
 */

import {
  getTransactionByPaymentId,
  updateTransactionStatus,
  type TransactionStatus,
} from "@/database/transactions"

export type ReconcileResult = {
  transactionId: string | null
  previousStatus: string | null
  newStatus: TransactionStatus | null
  skipped: boolean
  skipReason?: string
}

// Transaction statuses that are safe to overwrite (non-terminal).
// Exported so callers that pre-check before calling reconcileTransactionForPayment
// can use the same set rather than defining their own copy.
export const NON_TERMINAL_TX_STATUSES = new Set<string>(["PENDING", "PROCESSING"])

export type TerminalPaymentStatus = "CONFIRMED" | "FAILED" | "INCOMPLETE" | "EXPIRED" | "CANCELLED"

/**
 * Map a terminal payment status to the matching transaction status.
 * EXPIRED and CANCELLED payments have no dedicated transaction state and
 * map to INCOMPLETE (the production-standard abandoned/incomplete state).
 */
export function paymentToTransactionTerminalStatus(
  paymentStatus: TerminalPaymentStatus
): TransactionStatus {
  if (paymentStatus === "CONFIRMED") return "CONFIRMED"
  if (paymentStatus === "FAILED") return "FAILED"
  // INCOMPLETE, EXPIRED, and CANCELLED all map to INCOMPLETE on the transaction
  return "INCOMPLETE"
}

/**
 * Reconcile the linked transaction row to match a terminal payment state.
 *
 * Rules (in priority order):
 *  1. No linked transaction → skip (nothing to reconcile).
 *  2. Payment CONFIRMED → always force transaction to CONFIRMED, even if FAILED/INCOMPLETE.
 *     CONFIRMED is the strongest authoritative state.
 *  3. Payment FAILED / INCOMPLETE / EXPIRED / CANCELLED:
 *     a. Transaction already CONFIRMED → skip (never downgrade a confirmed tx).
 *     b. Transaction already in any other terminal state → skip (already settled).
 *     c. Transaction has provider_transaction_id → skip (real on-chain evidence;
 *        do not incorrectly discard it).
 *     d. Otherwise → update to FAILED or INCOMPLETE respectively.
 *
 * Returns a summary describing what happened (for logging).
 * Never throws — reconciliation failures are logged but must not block
 * the authoritative payment status write.
 */
export async function reconcileTransactionForPayment(
  paymentId: string,
  terminalPaymentStatus: TerminalPaymentStatus
): Promise<ReconcileResult> {
  let transaction: Awaited<ReturnType<typeof getTransactionByPaymentId>>

  try {
    transaction = await getTransactionByPaymentId(paymentId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[reconcileTransaction] failed to fetch transaction", { paymentId, error: message })
    return { transactionId: null, previousStatus: null, newStatus: null, skipped: true, skipReason: `fetch_error: ${message}` }
  }

  if (!transaction) {
    return {
      transactionId: null,
      previousStatus: null,
      newStatus: null,
      skipped: true,
      skipReason: "no_linked_transaction",
    }
  }

  const targetTxStatus = paymentToTransactionTerminalStatus(terminalPaymentStatus)

  // ── Rule 2: CONFIRMED payment always wins ────────────────────────────────────
  if (terminalPaymentStatus === "CONFIRMED") {
    if (transaction.status === "CONFIRMED") {
      return {
        transactionId: transaction.id,
        previousStatus: transaction.status,
        newStatus: null,
        skipped: true,
        skipReason: "already_confirmed",
      }
    }
    try {
      await updateTransactionStatus(transaction.id, "CONFIRMED")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[reconcileTransaction] update failed", { paymentId, transactionId: transaction.id, error: message })
      return { transactionId: transaction.id, previousStatus: transaction.status, newStatus: null, skipped: true, skipReason: `update_error: ${message}` }
    }
    return {
      transactionId: transaction.id,
      previousStatus: transaction.status,
      newStatus: "CONFIRMED",
      skipped: false,
    }
  }

  // ── Rules 3a–3d: FAILED / INCOMPLETE / EXPIRED / CANCELLED payment ───────────

  // 3a: never downgrade a confirmed transaction
  if (transaction.status === "CONFIRMED") {
    return {
      transactionId: transaction.id,
      previousStatus: transaction.status,
      newStatus: null,
      skipped: true,
      skipReason: "transaction_already_confirmed",
    }
  }

  // 3b: skip already-terminal transactions
  if (!NON_TERMINAL_TX_STATUSES.has(transaction.status)) {
    return {
      transactionId: transaction.id,
      previousStatus: transaction.status,
      newStatus: null,
      skipped: true,
      skipReason: "already_terminal",
    }
  }

  // 3c: skip INCOMPLETE / EXPIRED / CANCELLED when on-chain evidence exists.
  //
  // Rationale: these three statuses mean "abandoned with no confirmed payment."
  // If the transaction has a provider_transaction_id the customer DID submit a
  // transaction — marking it INCOMPLETE would be incorrect.
  //
  // FAILED is intentionally excluded from this guard.  A hard FAILED (reverted
  // tx, wrong amount, rejected payment, expired session after payment attempt)
  // is already validated by hasFailureEvidence() in updatePaymentStatus before
  // we get here, so it is always authoritative and must propagate even when
  // provider_transaction_id is set.
  const isFailed = terminalPaymentStatus === "FAILED"
  if (!isFailed) {
    const hasProviderTxId = Boolean(String(transaction.provider_transaction_id || "").trim())
    if (hasProviderTxId) {
      return {
        transactionId: transaction.id,
        previousStatus: transaction.status,
        newStatus: null,
        skipped: true,
        skipReason: "has_provider_transaction_id",
      }
    }
  }

  // 3d: update the non-terminal transaction
  try {
    await updateTransactionStatus(transaction.id, targetTxStatus)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[reconcileTransaction] update failed", { paymentId, transactionId: transaction.id, targetTxStatus, error: message })
    return { transactionId: transaction.id, previousStatus: transaction.status, newStatus: null, skipped: true, skipReason: `update_error: ${message}` }
  }

  return {
    transactionId: transaction.id,
    previousStatus: transaction.status,
    newStatus: targetTxStatus,
    skipped: false,
  }
}
