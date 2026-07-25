import { beforeEach, describe, expect, it } from "vitest"
import {
  hasProvenBaseUsdcEip3009MethodUnsupported,
  rememberBaseUsdcEip3009MethodUnsupported,
  resetBaseUsdcEip3009SessionMemoryForTests,
} from "@/lib/pos/posBaseUsdcEip3009SessionMemory"

/**
 * Regression coverage for Part 6's "remember a proven unsupported result for
 * the session" requirement: once a payment's wallet has conclusively proven
 * it can't do eth_signTypedData_v4, a retry of that SAME payment must not
 * re-attempt EIP-3009 — but this must never generalize into a permanent or
 * cross-payment wallet blacklist.
 */

describe("posBaseUsdcEip3009SessionMemory", () => {
  beforeEach(() => {
    resetBaseUsdcEip3009SessionMemoryForTests()
  })

  it("a payment with nothing remembered reports false", () => {
    expect(hasProvenBaseUsdcEip3009MethodUnsupported("pay-1")).toBe(false)
  })

  it("remembering a payment makes hasProven true for that exact paymentId", () => {
    rememberBaseUsdcEip3009MethodUnsupported("pay-1")
    expect(hasProvenBaseUsdcEip3009MethodUnsupported("pay-1")).toBe(true)
  })

  it("does not generalize to a different payment (no wallet-wide blacklist)", () => {
    rememberBaseUsdcEip3009MethodUnsupported("pay-1")
    expect(hasProvenBaseUsdcEip3009MethodUnsupported("pay-2")).toBe(false)
  })

  it("resetBaseUsdcEip3009SessionMemoryForTests clears all remembered payments", () => {
    rememberBaseUsdcEip3009MethodUnsupported("pay-1")
    rememberBaseUsdcEip3009MethodUnsupported("pay-2")
    resetBaseUsdcEip3009SessionMemoryForTests()
    expect(hasProvenBaseUsdcEip3009MethodUnsupported("pay-1")).toBe(false)
    expect(hasProvenBaseUsdcEip3009MethodUnsupported("pay-2")).toBe(false)
  })
})
