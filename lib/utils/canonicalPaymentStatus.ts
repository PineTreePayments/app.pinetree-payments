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
 * Canonical payment lifecycle statuses used throughout PineTree reads.
 * Legacy spellings are normalized, while CANCELED, EXPIRED, and INCOMPLETE
 * remain distinct on every surface. REFUNDED is an adjustment, not lifecycle.
 */
export type CanonicalPaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"
  | "INCOMPLETE"

export type NormalizedStoredPaymentStatus = CanonicalPaymentStatus | "REFUNDED"
export type TransactionDisplayStatus = NormalizedStoredPaymentStatus

/**
 * Normalise a raw DB payment status (from either the payments or transactions
 * table) to a canonical lifecycle or post-settlement presentation state.
 *
 *   CANCELLED       → CANCELED (legacy spelling only)
 *   REFUNDED        → REFUNDED (post-settlement adjustment)
 *   invalid / null  → throws; persisted payment statuses must be canonical
 */
export function normalizeStoredPaymentStatus(
  raw: string | null | undefined
): NormalizedStoredPaymentStatus {
  const s = String(raw ?? "").trim().toUpperCase()
  switch (s) {
    case "CANCELLED":
      return "CANCELED"
    case "REFUNDED":
      return "REFUNDED"
    case "CREATED":
    case "PENDING":
    case "PROCESSING":
    case "CONFIRMED":
    case "FAILED":
    case "EXPIRED":
    case "CANCELED":
    case "INCOMPLETE":
      return s as CanonicalPaymentStatus
    default:
      throw new Error(`Invalid payment status: ${s || "(empty)"}`)
  }
}

/**
 * Return true when the status represents a definitively confirmed payment.
 * Post-settlement refunds remain distinct and are not confirmed status.
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
  return norm === "FAILED" || norm === "INCOMPLETE" || norm === "EXPIRED" || norm === "CANCELED"
}

/**
 * Return true when the status is any terminal state (no further transitions
 * should be applied by the engine sweep or reconciliation).
 */
export function isTerminalStatus(raw: string | null | undefined): boolean {
  const norm = normalizeStoredPaymentStatus(raw)
  return norm === "CONFIRMED" || norm === "FAILED" || norm === "INCOMPLETE" ||
    norm === "EXPIRED" || norm === "CANCELED" || norm === "REFUNDED"
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
 * Resolve a lifecycle value for legacy callers that still supply both fields.
 * The transaction argument is deliberately ignored: only payments.status can
 * represent the current payment lifecycle.
 */
export function resolveTransactionDisplayStatus(
  txStatus: string | null | undefined,
  paymentStatus: string | null | undefined
): TransactionDisplayStatus {
  void txStatus
  const pmtNorm = normalizeStoredPaymentStatus(paymentStatus)
  if (pmtNorm === "REFUNDED") {
    throw new Error("REFUNDED is an adjustment and cannot replace the payment lifecycle status")
  }
  return pmtNorm
}
