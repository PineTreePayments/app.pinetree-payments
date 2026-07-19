import { describe, expect, it } from "vitest"
import {
  getConfiguredSpeedHeaderAccountIdPrefix,
  resolveSpeedHeaderAccountId,
  SpeedHeaderAccountIdUnresolvedError,
} from "@/providers/lightning/speedHeaderAccountResolver"

describe("resolveSpeedHeaderAccountId", () => {
  it("uses only the canonical acct_ connected account", () => {
    expect(resolveSpeedHeaderAccountId({ merchant_id: "m1", speed_account_id: "acct_123" })).toBe("acct_123")
    expect(getConfiguredSpeedHeaderAccountIdPrefix()).toBe("acct_")
  })

  it("fails closed without a canonical account and never falls back to a legacy field", () => {
    expect(() => resolveSpeedHeaderAccountId({
      merchant_id: "m1",
      speed_account_id: null,
      speed_header_account_id: "acct_legacy",
    })).toThrow(SpeedHeaderAccountIdUnresolvedError)
  })

  it("rejects relationship IDs as header account identity", () => {
    expect(() => resolveSpeedHeaderAccountId({ merchant_id: "m1", speed_account_id: "ca_relationship" }))
      .toThrow(expect.objectContaining({ reason: "invalid_format" }))
  })

  it("rejects a conflicting legacy header value", () => {
    expect(() => resolveSpeedHeaderAccountId({
      merchant_id: "m1",
      speed_account_id: "acct_123",
      speed_header_account_id: "acct_other",
    })).toThrow(expect.objectContaining({ reason: "mismatch" }))
  })

  it("retains merchant identity in sanitized diagnostics", () => {
    try {
      resolveSpeedHeaderAccountId({ merchant_id: "merchant_42", speed_account_id: null })
    } catch (error) {
      expect((error as SpeedHeaderAccountIdUnresolvedError).merchantId).toBe("merchant_42")
    }
  })
})
