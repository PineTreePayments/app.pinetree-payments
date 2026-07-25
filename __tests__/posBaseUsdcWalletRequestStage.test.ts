import { describe, expect, it } from "vitest"
import { PosBaseUsdcWalletRequestStageGuard } from "@/lib/pos/posBaseUsdcWalletRequestStage"

/**
 * Regression coverage for Part 5 of the Base USDC approval-prompt fix:
 * "guarantee one wallet request at a time." These are direct, behavioral
 * tests of the pure stage guard (see posLayoutBaseUsdcFallbackWiring.test.ts
 * for structural proof that components/pos/POSLayout.tsx actually wires this
 * guard into every eth_signTypedData_v4 / eth_sendTransaction call site).
 */

function owner(overrides: Partial<{ paymentId: string; intentId: string; attemptId: number }> = {}) {
  return { paymentId: "pay-1", intentId: "intent-1", attemptId: 1, ...overrides }
}

describe("PosBaseUsdcWalletRequestStageGuard", () => {
  it("starts idle", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    expect(guard.getStage()).toBe("idle")
  })

  it("begin() succeeds from idle and moves to the requested stage", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    expect(guard.begin("typed_data_signing", owner())).toBe(true)
    expect(guard.getStage()).toBe("typed_data_signing")
  })

  it("a second begin() while a request is in flight is a strict no-op — never throws, just returns false", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    guard.begin("typed_data_signing", owner())
    expect(() => guard.begin("allowance_approval", owner())).not.toThrow()
    expect(guard.begin("allowance_approval", owner())).toBe(false)
    // The original stage is untouched by the rejected second attempt.
    expect(guard.getStage()).toBe("typed_data_signing")
  })

  it("the SAME owner calling begin() twice (e.g. a double-tap or a re-entrant call) is also rejected", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    const o = owner()
    expect(guard.begin("payment_sending", o)).toBe(true)
    expect(guard.begin("payment_sending", o)).toBe(false)
  })

  it("end() by the owner returns the guard to idle", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    const o = owner()
    guard.begin("typed_data_signing", o)
    guard.end(o)
    expect(guard.getStage()).toBe("idle")
  })

  it("end() by a non-owner (a stale/superseded attempt) is a silent no-op", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    guard.begin("typed_data_signing", owner({ attemptId: 1 }))
    guard.end(owner({ attemptId: 2 }))
    expect(guard.getStage()).toBe("typed_data_signing")
  })

  it("after end(), a new request may begin (the guard is reusable across sequential stages)", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    const o = owner()
    guard.begin("allowance_approval", o)
    guard.end(o)
    expect(guard.begin("payment_sending", o)).toBe(true)
  })

  it("isOwner() only returns true for the exact current owner while a stage is active", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    const o = owner()
    expect(guard.isOwner(o)).toBe(false) // idle — nobody owns anything yet
    guard.begin("typed_data_signing", o)
    expect(guard.isOwner(o)).toBe(true)
    expect(guard.isOwner(owner({ paymentId: "pay-2" }))).toBe(false)
    expect(guard.isOwner(owner({ intentId: "intent-2" }))).toBe(false)
    expect(guard.isOwner(owner({ attemptId: 99 }))).toBe(false)
  })

  it("reset() forces idle regardless of who owns the current stage — used on resetSale()/attempt invalidation", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    guard.begin("payment_sending", owner())
    guard.reset()
    expect(guard.getStage()).toBe("idle")
    // A fresh attempt (new owner) can now begin immediately.
    expect(guard.begin("typed_data_signing", owner({ attemptId: 2 }))).toBe(true)
  })

  it("simulates the concurrency scenarios: a repeated realtime/poll trigger while a request is in flight never gets a second begin()", () => {
    const guard = new PosBaseUsdcWalletRequestStageGuard()
    const o = owner()
    expect(guard.begin("typed_data_signing", o)).toBe(true)
    // React effect re-run / repeated realtime update / repeated poll / double
    // click all reduce to "something else tries to begin a stage" — every
    // one of them must be rejected while the first is still in flight.
    for (let i = 0; i < 5; i++) {
      expect(guard.begin("typed_data_signing", o)).toBe(false)
    }
    guard.end(o)
    expect(guard.begin("allowance_approval", o)).toBe(true)
  })
})
