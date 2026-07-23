/**
 * PineTree Payment Reconciliation Bypass
 *
 * The standard state machine (paymentStateMachine.ts) intentionally treats
 * INCOMPLETE as terminal — no normal caller (webhook, watcher poll, cancel,
 * timeout) may ever move a payment out of it. That invariant is correct for
 * every ordinary code path.
 *
 * It is NOT correct for one narrow case: a payment was marked INCOMPLETE
 * (cancel, timeout, or premature failure classification) before the engine
 * ever learned that a real transaction had already been submitted/confirmed
 * on-chain. When independently verified chain evidence later proves the
 * payment did in fact succeed, the record must be repaired — never left
 * permanently wrong, and never silently rewritten (a `payment.reconciled`
 * audit event is always recorded alongside the transition).
 *
 * This module is the ONLY place allowed to move a payment out of INCOMPLETE.
 * It performs a single compare-and-set DB write (INCOMPLETE -> PROCESSING)
 * guarded on the current stored status, so a concurrent writer can never be
 * clobbered. Once the bypass succeeds, normal flow resumes: the caller
 * re-enters engine/eventProcessor.ts's processPaymentEvent, which — now that
 * the payment is PROCESSING, a perfectly ordinary non-terminal state — uses
 * the existing, already-guarded PROCESSING -> CONFIRMED path with no special
 * casing required.
 */

import { getPaymentById, createPaymentEvent, updatePaymentStatus as updatePaymentStatusInDb } from "@/database"
import { normalizeToStrictPaymentStatus } from "./paymentStateMachine"

export type ReconciliationRepairResult = {
  repaired: boolean
  reason: string
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
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    return { repaired: false, reason: "payment_not_found" }
  }

  const currentStatus = normalizeToStrictPaymentStatus(payment.status)
  if (currentStatus !== "INCOMPLETE") {
    return { repaired: false, reason: "not_incomplete" }
  }

  try {
    // Compare-and-set: only succeeds if the row is still INCOMPLETE at write
    // time. If a concurrent process already moved it, this throws and we
    // treat it as a no-op rather than a hard failure.
    await updatePaymentStatusInDb(paymentId, "PROCESSING", "INCOMPLETE")
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
      previousStatus: "INCOMPLETE",
      repairedTo: "PROCESSING",
      txHash: evidence.txHash,
      value: evidence.value,
      from: evidence.from
    }
  })

  console.info("[paymentReconciliation] repaired falsely-incomplete payment", {
    paymentId,
    txHash: evidence.txHash || null
  })

  return { repaired: true, reason: "chain_evidence_verified" }
}
