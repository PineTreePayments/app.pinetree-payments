import { beforeEach, describe, expect, it } from "vitest"
import { PosBaseDuplicateGuard } from "@/lib/pos/posBaseDuplicateGuard"

/**
 * Regression coverage for the production incident where a completed,
 * disconnected Base payment restarted WalletConnect from scratch (new
 * pairing, new proposal) after a stale poll tick or a realtime UPDATE event
 * — fired by the flow's own session-mirror writes to the same
 * payment_intents row — rediscovered selectedNetwork="base" once
 * posBaseRunningRef had already been reset to false by the completed
 * attempt's own cleanup.
 *
 * These are direct, behavioral tests of the pure decision engine (see
 * lib/pos/posBaseDuplicateGuard.ts), not string assertions against
 * components/pos/POSLayout.tsx — a separate structural test suite
 * (posBaseDuplicateFlowWiring.test.ts) proves POSLayout.tsx actually wires
 * this class in at the right points.
 */

describe("PosBaseDuplicateGuard", () => {
  let guard: PosBaseDuplicateGuard

  beforeEach(() => {
    guard = new PosBaseDuplicateGuard()
  })

  it("a successful Base payment cannot restart after disconnect: once marked terminal, the same intent+payment+attempt is blocked forever", () => {
    const intentId = "intent-1"
    const paymentId = "payment-1"
    const attemptId = 1

    expect(guard.evaluateLocalStart(intentId, paymentId, attemptId)).toEqual({ blocked: false })

    // Attempt completes successfully — runPosBaseFlow's finally block marks it terminal.
    guard.markTerminal(intentId, paymentId, attemptId)

    // A stale poll tick or realtime UPDATE event tries to restart the exact same attempt.
    expect(guard.evaluateLocalStart(intentId, paymentId, attemptId)).toEqual({
      blocked: true,
      reason: "attempt_already_terminal",
    })
  })

  it("realtime and polling callbacks cannot restart the completed payment even across many repeated re-checks", () => {
    const intentId = "intent-2"
    const paymentId = "payment-2"
    const attemptId = 1
    guard.markTerminal(intentId, paymentId, attemptId)

    for (let i = 0; i < 25; i++) {
      expect(guard.evaluateLocalStart(intentId, paymentId, attemptId).blocked).toBe(true)
    }
  })

  it("server-truth check blocks a restart when the session already reached a txHash, payment_submitted, or confirming step", () => {
    expect(guard.evaluateServerState({ sessionTxHash: "0xabc" })).toEqual({
      blocked: true,
      reason: "payment_has_txhash",
    })
    expect(guard.evaluateServerState({ sessionStep: "payment_submitted" })).toEqual({
      blocked: true,
      reason: "session_step_payment_submitted",
    })
    expect(guard.evaluateServerState({ sessionStep: "confirming" })).toEqual({
      blocked: true,
      reason: "session_step_confirming",
    })
  })

  it("server-truth check blocks a restart for every processing or terminal payment status", () => {
    for (const status of ["PROCESSING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELED", "INCOMPLETE"]) {
      expect(guard.evaluateServerState({ paymentStatus: status })).toEqual({
        blocked: true,
        reason: `payment_status_${status}`,
      })
      // Case-insensitive, matching how the status API may return it.
      expect(guard.evaluateServerState({ paymentStatus: status.toLowerCase() })).toEqual({
        blocked: true,
        reason: `payment_status_${status}`,
      })
    }
  })

  it("server-truth check does not block a payment still in an in-progress, pre-terminal state", () => {
    expect(guard.evaluateServerState({ paymentStatus: "PENDING" })).toEqual({ blocked: false })
    expect(guard.evaluateServerState({ sessionStep: "awaiting_wallet" })).toEqual({ blocked: false })
    expect(guard.evaluateServerState({ sessionStep: "wallet_connected" })).toEqual({ blocked: false })
    expect(guard.evaluateServerState({})).toEqual({ blocked: false })
  })

  it("POS reset cannot restart the prior intent: evaluateLocalStart is blocked for the whole reset window", () => {
    const intentId = "intent-3"
    const paymentId = "payment-3"
    const attemptId = 1

    guard.setResetInProgress(true)
    expect(guard.evaluateLocalStart(intentId, paymentId, attemptId)).toEqual({
      blocked: true,
      reason: "pos_reset_in_progress",
    })

    guard.setResetInProgress(false)
    expect(guard.evaluateLocalStart(intentId, paymentId, attemptId)).toEqual({ blocked: false })
  })

  it("a new payment intent can still start normally: reset() clears prior terminal markers so a fresh intent is never blocked", () => {
    const oldIntentId = "intent-old"
    const paymentId = "payment-old"
    guard.markTerminal(oldIntentId, paymentId, 1)
    expect(guard.evaluateLocalStart(oldIntentId, paymentId, 1).blocked).toBe(true)

    // A genuinely new payment intent mounts.
    guard.reset()

    // The old intent+payment+attempt combo is irrelevant now (a new intent
    // never reuses the old intentId), and reset() has cleared all prior
    // suppression state so nothing lingers.
    expect(guard.evaluateLocalStart(oldIntentId, paymentId, 1)).toEqual({ blocked: false })
    const newIntentId = "intent-new"
    const newPaymentId = "payment-new"
    expect(guard.evaluateLocalStart(newIntentId, newPaymentId, 1)).toEqual({ blocked: false })
  })

  it("a genuinely new attempt against the same intent (a freshly incremented attemptId) is never blocked by an older terminal attempt", () => {
    const intentId = "intent-4"
    const paymentId = "payment-4"
    guard.markTerminal(intentId, paymentId, 1)

    // Attempt 2 against the same intent+payment (e.g. the customer switched
    // rails and back) gets a new attemptId and must not be suppressed by
    // attempt 1's terminal marker.
    expect(guard.evaluateLocalStart(intentId, paymentId, 2)).toEqual({ blocked: false })
  })

  it("marking one attempt terminal does not suppress a different paymentId under the same intent", () => {
    const intentId = "intent-5"
    guard.markTerminal(intentId, "payment-a", 1)
    expect(guard.evaluateLocalStart(intentId, "payment-b", 1)).toEqual({ blocked: false })
  })
})
