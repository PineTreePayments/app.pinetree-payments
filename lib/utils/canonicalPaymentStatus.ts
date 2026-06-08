/**
 * Canonical payment status normalization.
 *
 * Single shared source of truth for status guard logic used by the
 * admin overview, admin transaction explorer, merchant dashboard overview,
 * and merchant transactions ledger.
 *
 * Rules enforced here:
 *   Rule 10 — CONFIRMED is never downgraded (once confirmed, always confirmed).
 *   Rule 11 — FAILED is never converted to INCOMPLETE.
 *
 * Design notes:
 *   - This file handles guard/comparison logic only, NOT display labels or
 *     Tailwind classes.  For display use getPaymentDisplayStatus() in
 *     lib/utils/paymentStatus.ts.
 *   - Age-based PENDING→INCOMPLETE transitions belong exclusively in the
 *     engine sweep (engine/stalePaymentSweep.ts).  This file never inspects
 *     timestamps.
 */

/**
 * The 6-state canonical payment status used throughout the PineTree engine.
 *
 * EXPIRED and REFUNDED are not first-class engine states:
 *   EXPIRED  is normalised → INCOMPLETE (timed out, no payment received)
 *   REFUNDED is normalised → CONFIRMED  (payment was collected; later refunded)
 */
export type CanonicalPaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"

/**
 * Normalise a raw DB payment status (from either the payments or transactions
 * table) to the canonical 6-state set.
 *
 *   EXPIRED / CANCELLED → INCOMPLETE
 *   REFUNDED            → CONFIRMED
 *   unknown / null      → "PENDING"  (fail-safe; should not appear in practice)
 */
export function normalizeStoredPaymentStatus(
  raw: string | null | undefined
): CanonicalPaymentStatus {
  const s = String(raw ?? "").trim().toUpperCase()
  switch (s) {
    case "EXPIRED":
    case "CANCELLED":
      return "INCOMPLETE"
    case "REFUNDED":
      return "CONFIRMED"
    case "CREATED":
    case "PENDING":
    case "PROCESSING":
    case "CONFIRMED":
    case "FAILED":
    case "INCOMPLETE":
      return s as CanonicalPaymentStatus
    default:
      return "PENDING"
  }
}

/**
 * Return true when the status represents a definitively confirmed payment.
 * REFUNDED is also treated as confirmed (revenue was collected).
 */
export function isConfirmedStatus(raw: string | null | undefined): boolean {
  return normalizeStoredPaymentStatus(raw) === "CONFIRMED"
}

/**
 * Return true when the status is a hard terminal failure or abandonment.
 * Used to guard against overwriting terminal states with non-terminal ones.
 */
export function isTerminalFailureStatus(raw: string | null | undefined): boolean {
  const norm = normalizeStoredPaymentStatus(raw)
  return norm === "FAILED" || norm === "INCOMPLETE"
}

/**
 * Return true when the status is any terminal state (no further transitions
 * should be applied by the engine sweep or reconciliation).
 */
export function isTerminalStatus(raw: string | null | undefined): boolean {
  const norm = normalizeStoredPaymentStatus(raw)
  return norm === "CONFIRMED" || norm === "FAILED" || norm === "INCOMPLETE"
}

/**
 * Determine whether a payment is eligible to be marked INCOMPLETE by the
 * stale sweep.  Returns false for any of the following:
 *   - Already in a terminal state (CONFIRMED / FAILED / INCOMPLETE)
 *   - Currently PROCESSING (has detected-but-unconfirmed on-chain evidence)
 *   - FAILED must never become INCOMPLETE (Rule 11)
 *   - CONFIRMED must never be downgraded (Rule 10)
 */
export function isSafeToMarkIncomplete(raw: string | null | undefined): boolean {
  const norm = normalizeStoredPaymentStatus(raw)
  return norm === "CREATED" || norm === "PENDING"
}

/**
 * Resolve the canonical display status for a transaction row when both the
 * transaction status and its linked payment status are available.
 *
 * Precedence (highest first):
 *   1. CONFIRMED always wins — payment.CONFIRMED overrides tx.PENDING/PROCESSING.
 *   2. FAILED always propagates from payment → tx (see reconcileTransaction.ts
 *      fix: FAILED ignores provider_transaction_id guard).
 *   3. INCOMPLETE from payment overrides tx.PENDING when no evidence guard
 *      triggered (reconciliation handles this; this function is a display-layer
 *      safety net for rows where reconciliation hasn't run yet).
 *   4. Otherwise return the transaction's own stored status unchanged.
 *
 * NOTE: This function is only called in engine data-layer code that builds
 * transaction row objects for the dashboard.  The display function
 * getPaymentDisplayStatus() still receives a single string — it does NOT
 * perform any merging.
 */
export function resolveTransactionDisplayStatus(
  txStatus: string | null | undefined,
  paymentStatus: string | null | undefined
): CanonicalPaymentStatus {
  const txNorm = normalizeStoredPaymentStatus(txStatus)
  const pmtNorm = normalizeStoredPaymentStatus(paymentStatus)

  // Rule 10: CONFIRMED is never downgraded.
  if (pmtNorm === "CONFIRMED") return "CONFIRMED"
  if (txNorm === "CONFIRMED") return "CONFIRMED"

  // Rule 11: FAILED is never converted to INCOMPLETE.
  // If the payment is FAILED, the transaction must also reflect FAILED.
  if (pmtNorm === "FAILED") return "FAILED"

  // Payment INCOMPLETE and transaction not yet reconciled.
  if (pmtNorm === "INCOMPLETE" && (txNorm === "PENDING" || txNorm === "PROCESSING")) {
    return "INCOMPLETE"
  }

  // Default: use the transaction's own stored status.
  return txNorm
}
