/**
 * Structured lifecycle trace for the "wallet returned a hash" -> "checkout/POS
 * shows CONFIRMED" path. Isomorphic (client + server) — unlike
 * lib/payment/paymentSessionLog.ts (client-only, checkout-startup timing),
 * this covers the post-submission confirmation lifecycle and is logged from
 * both browser code and API routes/engine modules so a single paymentId's
 * trace can be reassembled from combined browser + server logs.
 *
 * Step vocabulary, in expected order:
 *   wallet_hash_returned, detect_request_sent, detect_request_received,
 *   detect_request_completed, payment_status_processing, watcher_started,
 *   watcher_detected_transaction, payment_status_confirmed,
 *   checkout_realtime_received, checkout_ui_updated,
 *   pos_realtime_received, pos_ui_updated
 *
 * "Supabase realtime event emitted" has no direct instrumentation point —
 * Postgres replication fires it as a side effect of the row UPDATE, outside
 * application code. payment_status_confirmed (and payment_status_processing)
 * mark the moment that write commits, which is the instant realtime emission
 * becomes possible; the next observable step is *_realtime_received on
 * whichever client picks up the change.
 */

export type ConfirmationTraceStep =
  | "wallet_hash_returned"
  | "detect_request_sent"
  | "detect_request_received"
  | "detect_request_completed"
  | "payment_status_processing"
  | "watcher_started"
  | "watcher_detected_transaction"
  | "payment_status_confirmed"
  | "checkout_realtime_received"
  | "checkout_ui_updated"
  | "pos_realtime_received"
  | "pos_ui_updated"

export function logConfirmationTrace(
  step: ConfirmationTraceStep,
  input: {
    paymentId?: string | null
    sessionAttemptId?: string | null
    transactionHash?: string | null
    payload?: Record<string, unknown>
  }
): void {
  console.info("[PaymentConfirmationTrace]", step, {
    paymentId: input.paymentId || null,
    sessionAttemptId: input.sessionAttemptId || null,
    transactionHash: input.transactionHash || null,
    t: Date.now(),
    ts: new Date().toISOString(),
    ...(input.payload || {})
  })
}
