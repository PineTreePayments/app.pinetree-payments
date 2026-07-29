/**
 * PineTree Payment Reconciliation Bypass
 *
 * The standard state machine (paymentStateMachine.ts) intentionally treats
 * INCOMPLETE as terminal — no normal caller (webhook, watcher poll, cancel,
 * timeout) may ever move a payment out of it. That invariant is correct for
 * every ordinary code path.
 *
 * It is NOT correct for one narrow case: a payment was marked terminal
 * (cancel, timeout, or premature failure classification) before the engine
 * ever learned that a real transaction had already been submitted/confirmed
 * on-chain. When independently verified chain evidence later proves the
 * payment did in fact succeed, the record must be repaired — never left
 * permanently wrong, and never silently rewritten (a `payment.reconciled`
 * audit event is always recorded alongside the transition).
 *
 * This module is the ONLY place allowed to move a payment out of INCOMPLETE
 * or FAILED. It performs a single compare-and-set DB write (terminal -> PROCESSING)
 * guarded on the current stored status, so a concurrent writer can never be
 * clobbered. Once the bypass succeeds, normal flow resumes: the caller
 * re-enters engine/eventProcessor.ts's processPaymentEvent, which — now that
 * the payment is PROCESSING, a perfectly ordinary non-terminal state — uses
 * the existing, already-guarded PROCESSING -> CONFIRMED path with no special
 * casing required.
 */

import { getPaymentById, createPaymentEvent, updatePaymentStatus as updatePaymentStatusInDb } from "@/database"
import { getPaymentEvents, type PaymentEvent } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { metadataHasPaymentEvidence } from "./paymentEvidence"
import { normalizeToStrictPaymentStatus } from "./paymentStateMachine"

export type ReconciliationRepairResult = {
  repaired: boolean
  reason: string
}

export type HistoricalCollapsedOutcome = "EXPIRED" | "CANCELED"

export type HistoricalCollapsedOutcomeEvidence = {
  eventId: string
  eventType: "payment.expired" | "payment.canceled" | "payment.cancelled"
  providerEvent: string | null
  occurredAt: string | null
  reason: string | null
}

export type HistoricalCollapsedOutcomeRepairResult = {
  paymentId: string
  mode: "dry-run" | "apply"
  candidate: boolean
  changed: boolean
  idempotent: boolean
  statusBefore: string | null
  proposedStatus: HistoricalCollapsedOutcome | null
  reason: string
  evidence: HistoricalCollapsedOutcomeEvidence | null
}

const COLLAPSED_OUTCOME_EVENTS = new Map<string, HistoricalCollapsedOutcome>([
  ["payment.expired", "EXPIRED"],
  ["payment.canceled", "CANCELED"],
  ["payment.cancelled", "CANCELED"],
])

const UNSAFE_HISTORICAL_EVENT_TYPES = new Set([
  "payment.processing",
  "payment.confirmed",
  "payment.failed",
])

const UNSAFE_HISTORICAL_TRANSACTION_STATUSES = new Set([
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "REFUNDED",
  "DISPUTED",
])

const SAFE_COLLAPSED_OUTCOME_TRANSACTION_STATUSES = new Set([
  "",
  "PENDING",
  "INCOMPLETE",
  "EXPIRED",
])

function normalizedEventType(event: Pick<PaymentEvent, "event_type">): string {
  return String(event.event_type || "").trim().toLowerCase()
}

function eventEpoch(event: Pick<PaymentEvent, "created_at">): number {
  const parsed = Date.parse(String(event.created_at || ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function payloadReason(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null
  const payload = rawPayload as Record<string, unknown>
  for (const key of ["reason", "cancellationReason", "cancelReason", "expiryReason"]) {
    const value = String(payload[key] || "").trim()
    if (value) return value
  }
  return null
}

function inferHistoricalCollapsedOutcome(events: readonly PaymentEvent[]): {
  target: HistoricalCollapsedOutcome
  evidence: HistoricalCollapsedOutcomeEvidence
} | null {
  const candidates = events
    .map((event) => ({ event, target: COLLAPSED_OUTCOME_EVENTS.get(normalizedEventType(event)) }))
    .filter((candidate): candidate is { event: PaymentEvent; target: HistoricalCollapsedOutcome } =>
      Boolean(candidate.target)
    )
    .sort((left, right) => {
      const byDate = eventEpoch(left.event) - eventEpoch(right.event)
      return byDate || String(left.event.id || "").localeCompare(String(right.event.id || ""))
    })

  const selected = candidates.at(-1)
  if (!selected) return null
  const eventType = normalizedEventType(selected.event) as HistoricalCollapsedOutcomeEvidence["eventType"]
  return {
    target: selected.target,
    evidence: {
      eventId: String(selected.event.id || ""),
      eventType,
      providerEvent: String(selected.event.provider_event || "").trim() || null,
      occurredAt: String(selected.event.created_at || "").trim() || null,
      reason: payloadReason(selected.event.raw_payload),
    },
  }
}

function historicalResult(input: Omit<HistoricalCollapsedOutcomeRepairResult, "changed" | "idempotent"> & {
  changed?: boolean
  idempotent?: boolean
}): HistoricalCollapsedOutcomeRepairResult {
  return {
    changed: false,
    idempotent: false,
    ...input,
  }
}

/**
 * Repair the legacy vocabulary collapse where an explicit persisted canceled
 * or expired outcome was stored as INCOMPLETE. This path is deliberately
 * bounded to one caller-supplied payment id and defaults to a read-only dry
 * run. It never changes the linked accounting transaction or writes a ledger.
 */
export async function reconcileHistoricalCollapsedPaymentOutcome(
  paymentId: string,
  options: { apply?: boolean } = {}
): Promise<HistoricalCollapsedOutcomeRepairResult> {
  const normalizedPaymentId = String(paymentId || "").trim()
  const mode = options.apply === true ? "apply" : "dry-run"
  if (!normalizedPaymentId) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: null,
      proposedStatus: null,
      reason: "payment_id_required",
      evidence: null,
    })
  }

  const payment = await getPaymentById(normalizedPaymentId)
  if (!payment) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: null,
      proposedStatus: null,
      reason: "payment_not_found",
      evidence: null,
    })
  }

  const storedStatus = String(payment.status || "").trim().toUpperCase()
  let currentStatus: string
  try {
    currentStatus = normalizeToStrictPaymentStatus(storedStatus)
  } catch {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus || null,
      proposedStatus: null,
      reason: "unsupported_payment_status",
      evidence: null,
    })
  }

  if (!["INCOMPLETE", "EXPIRED", "CANCELED"].includes(currentStatus)) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus,
      proposedStatus: null,
      reason: "not_incomplete_or_canonical_target",
      evidence: null,
    })
  }

  const [events, transaction] = await Promise.all([
    getPaymentEvents(normalizedPaymentId),
    getTransactionByPaymentId(normalizedPaymentId),
  ])

  const unsafeEvent = events.find((event) =>
    UNSAFE_HISTORICAL_EVENT_TYPES.has(normalizedEventType(event)) ||
    metadataHasPaymentEvidence(event.raw_payload)
  )
  if (unsafeEvent) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus,
      proposedStatus: null,
      reason: `unsafe_payment_event_evidence:${normalizedEventType(unsafeEvent)}`,
      evidence: null,
    })
  }

  const transactionStatus = String(transaction?.status || "").trim().toUpperCase()
  const transactionHash = String(transaction?.provider_transaction_id || "").trim()
  if (transactionHash) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus,
      proposedStatus: null,
      reason: "stored_transaction_hash_present",
      evidence: null,
    })
  }
  if (
    UNSAFE_HISTORICAL_TRANSACTION_STATUSES.has(transactionStatus) ||
    !SAFE_COLLAPSED_OUTCOME_TRANSACTION_STATUSES.has(transactionStatus)
  ) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus,
      proposedStatus: null,
      reason: `unsafe_transaction_status:${transactionStatus}`,
      evidence: null,
    })
  }

  const inference = inferHistoricalCollapsedOutcome(events)
  if (!inference) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus,
      proposedStatus: null,
      reason: "no_authoritative_outcome_event",
      evidence: null,
    })
  }

  if (currentStatus === inference.target) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: true,
      statusBefore: storedStatus,
      proposedStatus: inference.target,
      reason: "already_canonical_target",
      evidence: inference.evidence,
      idempotent: true,
    })
  }

  if (currentStatus !== "INCOMPLETE") {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: false,
      statusBefore: storedStatus,
      proposedStatus: inference.target,
      reason: "stored_target_conflicts_with_evidence",
      evidence: inference.evidence,
    })
  }

  const repairReason = inference.target === "EXPIRED"
    ? "persisted_payment_expired_event"
    : "persisted_payment_canceled_event"
  if (!options.apply) {
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: true,
      statusBefore: storedStatus,
      proposedStatus: inference.target,
      reason: repairReason,
      evidence: inference.evidence,
    })
  }

  try {
    await updatePaymentStatusInDb(normalizedPaymentId, inference.target, "INCOMPLETE")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return historicalResult({
      paymentId: normalizedPaymentId,
      mode,
      candidate: true,
      statusBefore: storedStatus,
      proposedStatus: inference.target,
      reason: `cas_failed:${message}`,
      evidence: inference.evidence,
    })
  }

  try {
    await createPaymentEvent({
      id: crypto.randomUUID(),
      payment_id: normalizedPaymentId,
      event_type: "payment.reconciled",
      provider_event: "reconciliation.historical_collapsed_outcome",
      raw_payload: {
        oldValue: storedStatus,
        newValue: inference.target,
        reason: repairReason,
        evidenceSource: "persisted_payment_events",
        evidence: inference.evidence,
        linkedTransactionStatusPreserved: transactionStatus || null,
      },
    })
  } catch (auditError) {
    const auditMessage = auditError instanceof Error ? auditError.message : String(auditError)
    try {
      // The correction and audit append cannot share a transaction through the
      // current Data API. Compensate with a second CAS so an audit failure does
      // not silently leave the repaired status behind.
      await updatePaymentStatusInDb(normalizedPaymentId, "INCOMPLETE", inference.target)
      console.error("[paymentReconciliation] audit append failed; correction rolled back", {
        paymentId: normalizedPaymentId,
        attemptedOldValue: storedStatus,
        attemptedNewValue: inference.target,
        auditError: auditMessage,
      })
      return historicalResult({
        paymentId: normalizedPaymentId,
        mode,
        candidate: true,
        statusBefore: storedStatus,
        proposedStatus: inference.target,
        reason: `audit_event_failed_rolled_back:${auditMessage}`,
        evidence: inference.evidence,
      })
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      console.error("[paymentReconciliation] CRITICAL unaudited correction rollback failed", {
        paymentId: normalizedPaymentId,
        oldValue: storedStatus,
        newValue: inference.target,
        auditError: auditMessage,
        rollbackError: rollbackMessage,
      })
      throw new Error(
        `CRITICAL_UNAUDITED_RECONCILIATION payment=${normalizedPaymentId} ` +
        `audit=${auditMessage} rollback=${rollbackMessage}`
      )
    }
  }

  console.info("[paymentReconciliation] repaired collapsed historical outcome", {
    paymentId: normalizedPaymentId,
    oldValue: storedStatus,
    newValue: inference.target,
    reason: repairReason,
    evidenceEventId: inference.evidence.eventId,
  })

  return historicalResult({
    paymentId: normalizedPaymentId,
    mode,
    candidate: true,
    statusBefore: storedStatus,
    proposedStatus: inference.target,
    reason: repairReason,
    evidence: inference.evidence,
    changed: true,
  })
}

/**
 * Attempt to repair a payment currently stuck at INCOMPLETE by moving it to
 * PROCESSING, recording a `payment.reconciled` audit event that captures why
 * the canonical status changed. Never throws — a failed repair simply means
 * the normal (terminal, no-op) path continues to apply.
 */
export async function repairIncompletePaymentForReconciliation(
  paymentId: string,
  evidence: {
    txHash?: string
    value?: string
    from?: string
  }
): Promise<ReconciliationRepairResult> {
  return repairTerminalPaymentForReconciliation(paymentId, evidence, ["INCOMPLETE"])
}

export async function repairTerminalPaymentForReconciliation(
  paymentId: string,
  evidence: {
    txHash?: string
    value?: string
    from?: string
  },
  repairableStatuses: Array<"INCOMPLETE" | "FAILED" | "EXPIRED" | "CANCELED"> = [
    "INCOMPLETE",
    "FAILED",
    "EXPIRED",
    "CANCELED",
  ]
): Promise<ReconciliationRepairResult> {
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    return { repaired: false, reason: "payment_not_found" }
  }

  const currentStatus = normalizeToStrictPaymentStatus(payment.status)
  if (
    currentStatus !== "INCOMPLETE" &&
    currentStatus !== "FAILED" &&
    currentStatus !== "EXPIRED" &&
    currentStatus !== "CANCELED"
  ) {
    return { repaired: false, reason: "not_repairable_terminal_status" }
  }
  if (!repairableStatuses.includes(currentStatus)) {
    return { repaired: false, reason: `not_${repairableStatuses.join("_or_").toLowerCase()}` }
  }

  try {
    // Compare-and-set: only succeeds if the row is still at the same terminal status at write
    // time. If a concurrent process already moved it, this throws and we
    // treat it as a no-op rather than a hard failure.
    // Preserve the stored legacy spelling for the compare-and-set predicate;
    // normalizing CANCELLED to CANCELED before the CAS would never match it.
    const expectedStoredStatus = String(payment.status || "").trim().toUpperCase() as typeof currentStatus
    await updatePaymentStatusInDb(paymentId, "PROCESSING", expectedStoredStatus)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn("[paymentReconciliation] compare-and-set failed", { paymentId, error: message })
    return { repaired: false, reason: `cas_failed: ${message}` }
  }

  await createPaymentEvent({
    id: crypto.randomUUID(),
    payment_id: paymentId,
    event_type: "payment.reconciled",
      provider_event: "reconciliation.chain_evidence_verified",
      raw_payload: {
      previousStatus: currentStatus,
      repairedTo: "PROCESSING",
      txHash: evidence.txHash,
      value: evidence.value,
      from: evidence.from
    }
  })

  console.info("[paymentReconciliation] repaired falsely-terminal payment", {
    paymentId,
    previousStatus: currentStatus,
    txHash: evidence.txHash || null
  })

  return { repaired: true, reason: "chain_evidence_verified" }
}
