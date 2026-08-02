/**
 * PineTree Engine - Shift4 unknown-outcome recovery.
 *
 * Implements the documented sequence from Shift4's "Timeouts And Communication
 * Failures" guide:
 *
 *   1. wait 1-3s (production) or 3-5s (test);
 *   2. send an Invoice Information request for the SAME invoice;
 *   3. "Invoice Not Found"  -> the original transaction MAY be resent;
 *      invoice found        -> read transaction.responseCode;
 *      lookup itself failed -> one retry, then log for an auditor's review.
 *
 * Two rules are enforced here that the guide is emphatic about:
 *   - a failed transaction must NEVER be voided as cleanup;
 *   - a resend is only ever permitted on an authoritative "Invoice Not Found",
 *     and even then PineTree adds its own safety conditions, because Shift4
 *     returns that same text for a voided or already-settled invoice.
 *
 * The payment's canonical status is never set to FAILED by a timeout.
 *
 * Concurrency: an attempt is claimed through a database lease before any
 * provider call, and every write carries the version that was read. Two workers
 * therefore cannot both act on one attempt, and a slow worker cannot overwrite a
 * fresher result.
 */

import {
  applyShift4AttemptEvidence,
  claimDueShift4PaymentAttempts,
  getShift4PaymentAttempt,
  releaseShift4AttemptLease,
  type Shift4PaymentAttemptRow,
} from "@/database/shift4PaymentAttempts"
import { getPaymentById } from "@/database/payments"
import { getShift4RestAccessToken } from "@/database/merchantShift4RestConnections"
import { getInvoice, SHIFT4_RECOVERY_DELAY_MS } from "@/providers/shift4/rest"

import { eventNameForState, projectEvidence } from "./attempt"
import { mapShift4Evidence } from "./mapShift4Evidence"
import type { Shift4EngineOperation } from "./types"

/**
 * Shift4 permits ONE retry of a failed Invoice Information request before the
 * transaction is logged for an auditor. The provider client performs that
 * retry internally, so each Engine recovery pass is one logical lookup.
 * PineTree bounds the number of passes so an unresolvable attempt cannot spin.
 */
export const MAX_LOOKUP_PASSES = 5

/**
 * Operations Shift4 permits to be resent with the same invoice after an
 * authoritative "Invoice Not Found".
 *
 * `refund` and `void` are excluded deliberately: resending a refund can create
 * a second credit, and resending a void can double-reverse.
 */
const RESENDABLE_OPERATIONS = new Set<Shift4EngineOperation>(["sale", "authorization", "capture"])

/** Maximum same-invoice resends the Engine will ever authorize. */
export const MAX_RESENDS = 1

/** How long a recovery worker holds an attempt before the lease expires. */
const RECOVERY_LEASE_SECONDS = 120

export type Shift4RecoveryOutcome = {
  attemptId: string
  resolved: boolean
  action:
    | "not_due"
    | "resolved_approved"
    | "resolved_declined"
    | "invoice_not_found"
    | "still_unresolved"
    | "exhausted"
    | "skipped"
  appliedStatus: string | null
  resendEligible: boolean
  reason: string
}

/**
 * Run one recovery pass for an attempt that has already been claimed.
 *
 * Separated from claiming so the reconciliation loop can claim a bounded batch
 * once and then process each row, and so a single-attempt recovery can claim
 * exactly the row it needs.
 */
export async function recoverClaimedAttempt(input: {
  attempt: Pick<
    Shift4PaymentAttemptRow,
    | "attempt_id"
    | "merchant_id"
    | "payment_id"
    | "merchant_provider_connection_id"
    | "operation"
    | "invoice"
    | "amount_minor"
    | "correlation_id"
    | "lookup_attempt_count"
    | "resend_count"
    | "version"
    | "state"
    | "recovery_state"
    | "response_code"
    | "authorization_code"
    | "retrieval_reference"
    | "resolution_reason"
  >
  leaseOwner: string
  now?: number
}): Promise<Shift4RecoveryOutcome> {
  const { attempt, leaseOwner } = input
  const now = input.now ?? Date.now()
  const passes = Number(attempt.lookup_attempt_count || 0)

  /* ── Bounded passes ────────────────────────────────────────────────────── */
  if (passes >= MAX_LOOKUP_PASSES) {
    await applyShift4AttemptEvidence({
      merchantId: attempt.merchant_id,
      attemptId: attempt.attempt_id,
      expectedVersion: attempt.version,
      leaseOwner,
      state: "reconciliation_required",
      recoveryState: "exhausted",
      targetStatus: null,
      shift4Event: "shift4.reconciliation_required",
      evidenceSource: "engine_recovery",
      resolutionReason: "lookup_passes_exhausted",
      releaseLease: true,
    })
    return {
      attemptId: attempt.attempt_id,
      resolved: false,
      action: "exhausted",
      appliedStatus: null,
      resendEligible: false,
      reason: "Invoice lookup did not resolve within the permitted number of passes.",
    }
  }

  const connection = await getShift4RestAccessToken(attempt.merchant_id)
  if (!connection) {
    await releaseShift4AttemptLease({
      merchantId: attempt.merchant_id,
      attemptId: attempt.attempt_id,
      leaseOwner,
    })
    return skipped(attempt.attempt_id, "connection_unavailable")
  }

  const window = SHIFT4_RECOVERY_DELAY_MS[connection.environment]

  /* ── Invoice Information ───────────────────────────────────────────────── */
  let lookup: Awaited<ReturnType<typeof getInvoice>>
  try {
    lookup = await getInvoice({
      invoice: attempt.invoice,
      accessToken: connection.accessToken,
      context: {
        correlationId: attempt.correlation_id,
        merchantId: attempt.merchant_id,
        merchantProviderConnectionId: attempt.merchant_provider_connection_id,
        pineTreePaymentId: attempt.payment_id,
        pineTreePaymentAttemptId: attempt.attempt_id,
        requestedAmountMinor: attempt.operation === "void" ? undefined : attempt.amount_minor,
      },
    })
  } catch (error) {
    // The lookup itself failed (the client already used its one permitted
    // retry). Keep recovery pending and schedule the next pass with backoff.
    const nextCheckAt = new Date(now + window.maxMs * (passes + 2)).toISOString()
    await applyShift4AttemptEvidence({
      merchantId: attempt.merchant_id,
      attemptId: attempt.attempt_id,
      expectedVersion: attempt.version,
      leaseOwner,
      state: "unresolved",
      recoveryState: "pending_lookup",
      targetStatus: null,
      shift4Event: "shift4.invoice_lookup_result",
      evidenceSource: "invoice_lookup",
      resolutionReason: "lookup_failed",
      nextCheckAt,
      incrementLookupCount: true,
      releaseLease: true,
    })
    console.warn("[shift4-engine] invoice_lookup_failed", {
      paymentId: attempt.payment_id,
      attemptId: attempt.attempt_id,
      pass: passes + 1,
      reason: error instanceof Error ? error.message : "unknown",
    })
    return {
      attemptId: attempt.attempt_id,
      resolved: false,
      action: "still_unresolved",
      appliedStatus: null,
      resendEligible: false,
      reason: "The Invoice Information request did not succeed on this pass.",
    }
  }

  /* ── Invoice Not Found ─────────────────────────────────────────────────── */
  if (!lookup.found) {
    const nextCheckAt = new Date(now + window.maxMs * (passes + 2)).toISOString()
    const applied = await applyShift4AttemptEvidence({
      merchantId: attempt.merchant_id,
      attemptId: attempt.attempt_id,
      expectedVersion: attempt.version,
      leaseOwner,
      state: "unresolved",
      recoveryState: "pending_lookup",
      targetStatus: null,
      shift4Event: "shift4.invoice_lookup_result",
      evidenceSource: "invoice_lookup",
      resolutionReason: "invoice_not_found",
      nextCheckAt,
      incrementLookupCount: true,
      // Hold the lease across the resend decision below. Releasing here would
      // let another worker claim the attempt in between, and its evidence write
      // would then be rejected as a lease conflict.
      releaseLease: false,
    })

    if (applied.outcome === "version_conflict" || applied.outcome === "lease_conflict") {
      return skipped(attempt.attempt_id, applied.outcome)
    }

    const payment = await getPaymentById(attempt.payment_id)
    const policy = evaluateResendPolicy({
      payment: { status: String(payment?.status || "") },
      attempt: {
        operation: attempt.operation,
        state: "unresolved",
        recoveryState: "pending_lookup",
        resolutionReason: "invoice_not_found",
        responseCode: attempt.response_code,
        authorizationCode: attempt.authorization_code,
        retrievalReference: attempt.retrieval_reference,
        resendCount: attempt.resend_count,
      },
    })

    // Every resend decision is preserved, allowed or not.
    await applyShift4AttemptEvidence({
      merchantId: attempt.merchant_id,
      attemptId: attempt.attempt_id,
      expectedVersion: applied.version ?? attempt.version + 1,
      leaseOwner,
      state: "unresolved",
      recoveryState: "pending_lookup",
      targetStatus: null,
      shift4Event: policy.allowed ? "shift4.resend_eligible" : "shift4.resend_blocked",
      evidenceSource: "engine_recovery",
      resolutionReason: policy.reason,
      nextCheckAt,
      releaseLease: true,
    })

    return {
      attemptId: attempt.attempt_id,
      resolved: false,
      action: "invoice_not_found",
      appliedStatus: null,
      resendEligible: policy.allowed,
      reason: policy.reason,
    }
  }

  /* ── Invoice found: resolve from authoritative evidence ────────────────── */
  const result = lookup.result
  const mapping = mapShift4Evidence({
    // The invoice reports the ORIGINAL operation's outcome, so map it as that
    // operation rather than as a lookup.
    operation: attempt.operation,
    result,
    requestedAmountMinor: attempt.amount_minor,
  })

  const evidence = projectEvidence(result)

  const applied = await applyShift4AttemptEvidence({
    merchantId: attempt.merchant_id,
    attemptId: attempt.attempt_id,
    expectedVersion: attempt.version,
    leaseOwner,
    state: mapping.attemptState,
    recoveryState: mapping.lookupRequired
      ? "pending_lookup"
      : mapping.reconciliationRequired
        ? "blocked"
        : "resolved",
    targetStatus: mapping.status,
    shift4Event: eventNameForState(mapping.attemptState),
    // The invoice lookup is Shift4's authoritative record, not a live response.
    evidenceSource: "invoice_lookup",
    resolutionReason: mapping.reason,
    // No authorization amount is supplied here either: recovery uses exactly
    // the same database-derived rule as a live response, so an invoice lookup
    // can never resolve to an invented authorized amount.
    nextCheckAt: mapping.lookupRequired
      ? new Date(now + window.maxMs * (passes + 2)).toISOString()
      : null,
    incrementLookupCount: true,
    releaseLease: true,
    ...evidence,
  })

  if (applied.outcome === "version_conflict" || applied.outcome === "lease_conflict") {
    return skipped(attempt.attempt_id, applied.outcome)
  }

  return {
    attemptId: attempt.attempt_id,
    resolved: Boolean(applied.appliedStatus) || mapping.terminal,
    action:
      mapping.attemptState === "approved"
        ? "resolved_approved"
        : mapping.attemptState === "declined"
          ? "resolved_declined"
          : "still_unresolved",
    appliedStatus: applied.appliedStatus,
    resendEligible: false,
    reason: mapping.reason,
  }
}

/**
 * Claim and recover one specific attempt.
 *
 * Returns `not_due` or `skipped` when the lease could not be taken, which is the
 * correct answer when another worker already holds it.
 */
export async function recoverUnknownOutcome(input: {
  merchantId: string
  attemptId: string
  leaseOwner?: string
  now?: number
}): Promise<Shift4RecoveryOutcome> {
  const now = input.now ?? Date.now()
  const leaseOwner = input.leaseOwner || `shift4-recovery-${crypto.randomUUID()}`

  const stored = await getShift4PaymentAttempt(input.merchantId, input.attemptId)
  if (!stored) return skipped(input.attemptId, "attempt_not_found")
  if (stored.recovery_state !== "pending_lookup") {
    return skipped(input.attemptId, `attempt_not_pending_lookup:${stored.recovery_state}`)
  }

  const claimed = await claimDueShift4PaymentAttempts({
    leaseOwner,
    leaseSeconds: RECOVERY_LEASE_SECONDS,
    limit: 1,
    merchantId: input.merchantId,
    attemptId: input.attemptId,
    now: new Date(now).toISOString(),
  })

  if (claimed.length === 0) {
    // Either the documented delay has not elapsed, or another worker holds it.
    return {
      attemptId: input.attemptId,
      resolved: false,
      action: "not_due",
      appliedStatus: null,
      resendEligible: false,
      reason:
        "The attempt is not due, or another recovery worker currently holds its lease.",
    }
  }

  const row = claimed[0]
  return recoverClaimedAttempt({
    attempt: {
      attempt_id: row.attemptId,
      merchant_id: row.merchantId,
      payment_id: row.paymentId,
      merchant_provider_connection_id: row.merchantProviderConnectionId,
      operation: row.operation,
      invoice: row.invoice,
      amount_minor: row.amountMinor,
      correlation_id: row.correlationId,
      lookup_attempt_count: row.lookupAttemptCount,
      resend_count: row.resendCount,
      version: row.version,
      state: row.state,
      recovery_state: row.recoveryState,
      response_code: row.responseCode,
      authorization_code: row.authorizationCode,
      retrieval_reference: row.retrievalReference,
      resolution_reason: row.resolutionReason,
    },
    leaseOwner,
    now,
  })
}

export type Shift4ResendPolicyDecision = {
  allowed: boolean
  reason: string
}

/**
 * Decide whether the ORIGINAL operation may be resent with the same invoice.
 *
 * Every condition must hold. The provider client never resends on its own;
 * this is the only place the decision is made, and every decision is recorded.
 */
export function evaluateResendPolicy(input: {
  payment: { status: string }
  attempt: {
    operation: Shift4EngineOperation
    state: string
    recoveryState: string
    resolutionReason: string | null
    responseCode: string | null
    authorizationCode: string | null
    retrievalReference: string | null
    resendCount: number
  }
}): Shift4ResendPolicyDecision {
  const { attempt } = input

  // 1. Shift4's authoritative lookup must have reported Invoice Not Found.
  if (attempt.resolutionReason !== "invoice_not_found") {
    return { allowed: false, reason: "shift4_did_not_report_invoice_not_found" }
  }

  // 2. The operation must be one Shift4 permits to be resent. A refund or void
  //    could create a duplicate credit or a double reversal.
  if (!RESENDABLE_OPERATIONS.has(attempt.operation)) {
    return { allowed: false, reason: `operation_not_resendable:${attempt.operation}` }
  }

  // 3. PineTree must hold no prior approved, captured, voided, settled, or
  //    refund evidence for this invoice. "Invoice Not Found" is ambiguous:
  //    Shift4 returns it for a voided or already-settled invoice too.
  if (
    attempt.authorizationCode ||
    attempt.retrievalReference ||
    attempt.state === "approved" ||
    attempt.responseCode === "A" ||
    attempt.responseCode === "C" ||
    attempt.responseCode === "P"
  ) {
    return { allowed: false, reason: "prior_approval_evidence_exists_for_invoice" }
  }

  // 4. The canonical payment must not already be terminal.
  const status = String(input.payment.status || "").toUpperCase()
  if (["CONFIRMED", "FAILED", "EXPIRED", "CANCELED", "INCOMPLETE"].includes(status)) {
    return { allowed: false, reason: `payment_already_terminal:${status}` }
  }

  // 5. Resend budget.
  if (Number(attempt.resendCount || 0) >= MAX_RESENDS) {
    return { allowed: false, reason: "resend_limit_reached" }
  }

  // 6. No conflicting recovery worker may hold the attempt.
  if (attempt.recoveryState === "blocked") {
    return { allowed: false, reason: "attempt_held_by_another_worker" }
  }

  return {
    allowed: true,
    reason: "invoice_not_found_with_no_conflicting_evidence",
  }
}

function skipped(attemptId: string, reason: string): Shift4RecoveryOutcome {
  return {
    attemptId,
    resolved: false,
    action: "skipped",
    appliedStatus: null,
    resendEligible: false,
    reason,
  }
}
