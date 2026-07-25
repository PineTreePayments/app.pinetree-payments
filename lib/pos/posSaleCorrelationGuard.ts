/**
 * Pure decision logic for whether a payment/intent status update belongs to
 * the POS terminal's CURRENTLY active sale.
 *
 * Extracted out of components/pos/POSLayout.tsx (mirroring the same pattern
 * already used for lib/pos/posBaseDuplicateGuard.ts) so the actual
 * correlation decision — the thing a delayed poll response, a delayed
 * realtime payload, or a stale timer callback all have to pass through —
 * can be tested directly without rendering the whole POS terminal
 * component.
 *
 * Production incident this closes: a completed Solana payment's own status
 * update arrived (via a poll response already in flight, or a realtime
 * message already dispatched by Supabase) after resetSale() had already
 * started a brand-new sale — one with a fresh intent but NO child payment
 * created yet. The existing correlation check
 * (`sourcePaymentId !== activePaymentId`) only worked when activePaymentId
 * was already populated; it was silently bypassed during exactly the
 * window a fresh sale has an intent but no payment yet, which is exactly
 * the window the stale update slipped through in. The generation check
 * below is the primary guard specifically because it still works in that
 * window — it does not depend on activePaymentId/activeIntentId being
 * non-empty at all.
 */

export type PosSaleUpdateSource =
  | "poll"
  | "realtime_direct_payment"
  | "realtime_intent_resolved_payment"

export type PosSaleActiveState = {
  generation: number
  intentId: string
  paymentId: string
}

export type PosSaleUpdateEvent = {
  source: PosSaleUpdateSource
  generation: number
  status: string
  sourcePaymentId?: string
  sourceIntentId?: string
}

export type PosSaleCorrelationResult =
  | { stale: false }
  | { stale: true; logPayload: Record<string, unknown> }

/**
 * Returns { stale: true } when the event's generation, intentId, or
 * paymentId disagree with what is currently active. Any ONE mismatch is
 * enough to reject the update — this must never apply a status change that
 * could belong to a different sale.
 */
export function evaluatePosSaleUpdate(
  event: PosSaleUpdateEvent,
  active: PosSaleActiveState
): PosSaleCorrelationResult {
  const isStale =
    event.generation !== active.generation ||
    Boolean(event.sourcePaymentId && active.paymentId && event.sourcePaymentId !== active.paymentId) ||
    Boolean(event.sourceIntentId && active.intentId && event.sourceIntentId !== active.intentId)

  if (!isStale) return { stale: false }

  return {
    stale: true,
    logPayload: {
      source: event.source,
      eventIntentId: event.sourceIntentId || null,
      eventPaymentId: event.sourcePaymentId || null,
      activeIntentId: active.intentId || null,
      activePaymentId: active.paymentId || null,
      eventGeneration: event.generation,
      activeGeneration: active.generation,
      status: event.status
    }
  }
}

/**
 * Logs a rejected update in the exact structured shape required for
 * production diagnosis. Never logs wallet addresses, QR payloads, Lightning
 * invoices, secrets, or full transaction data — the payload here is limited
 * to IDs, a generation counter, and a status string.
 */
export function logStalePosSaleUpdate(result: { stale: true; logPayload: Record<string, unknown> }): void {
  console.warn("[pos] stale payment update ignored", result.logPayload)
}
