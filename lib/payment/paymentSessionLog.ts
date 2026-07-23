"use client"

/**
 * Structured checkout timing/telemetry log, shared by the Base, Solana, and
 * Lightning checkout components.
 *
 * Every checkout attempt (one component mount that goes on to try a wallet)
 * gets a single sessionAttemptId, generated once and reused for every stage
 * log of that attempt. If the SAME paymentId ever shows two different
 * sessionAttemptIds logging the same stage (e.g. two "pairing_started" lines
 * for one payment), that is a duplicate initialization — the thing this log
 * exists to make visible. It intentionally does not dedupe or suppress
 * anything itself; it only reports, so it can prove absence of duplicates as
 * well as presence.
 *
 * Stage vocabulary (not every rail emits every stage — see each component):
 *   checkout_loaded, wallet_library_preload_started, wallet_library_preload_completed,
 *   wallet_list_ready, pairing_started, session_approved, wallet_opened,
 *   signature_requested, transaction_submitted, transaction_hash_stored,
 *   provider_detected, confirmed, watcher_stopped
 */

export type PaymentRail = "checkout" | "base" | "solana" | "lightning"

export type PaymentSessionStage =
  | "checkout_loaded"
  | "wallet_library_preload_started"
  | "wallet_library_preload_completed"
  | "wallet_list_ready"
  | "pairing_started"
  | "session_approved"
  | "wallet_opened"
  | "signature_requested"
  | "transaction_submitted"
  | "transaction_hash_stored"
  | "provider_detected"
  | "confirmed"
  | "watcher_stopped"

export function createSessionAttemptId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `sa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }
}

export function logPaymentSession(
  rail: PaymentRail,
  stage: PaymentSessionStage,
  input: {
    paymentId?: string | null
    sessionAttemptId: string
    payload?: Record<string, unknown>
  }
): void {
  console.info(`[PaymentSession:${rail}]`, stage, {
    paymentId: input.paymentId || null,
    sessionAttemptId: input.sessionAttemptId,
    t: Date.now(),
    ...(input.payload || {})
  })
}
