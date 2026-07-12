import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  resolveSpeedHeaderAccountId,
  getConfiguredSpeedHeaderAccountIdPrefix,
  SpeedHeaderAccountIdUnresolvedError,
} from "@/providers/lightning/speedHeaderAccountResolver"

describe("resolveSpeedHeaderAccountId", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("fails closed when speed_header_account_id is missing", () => {
    process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX = "ca_"
    expect(() =>
      resolveSpeedHeaderAccountId({ merchant_id: "merchant_1", speed_header_account_id: null })
    ).toThrow(SpeedHeaderAccountIdUnresolvedError)

    try {
      resolveSpeedHeaderAccountId({ merchant_id: "merchant_1", speed_header_account_id: "" })
    } catch (error) {
      expect(error).toBeInstanceOf(SpeedHeaderAccountIdUnresolvedError)
      expect((error as SpeedHeaderAccountIdUnresolvedError).reason).toBe("missing")
    }
  })

  it("fails closed when the prefix has not been confirmed, even with a stored value", () => {
    delete process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX
    try {
      resolveSpeedHeaderAccountId({ merchant_id: "merchant_1", speed_header_account_id: "ca_abc123" })
      throw new Error("expected resolveSpeedHeaderAccountId to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(SpeedHeaderAccountIdUnresolvedError)
      expect((error as SpeedHeaderAccountIdUnresolvedError).reason).toBe("prefix_not_configured")
    }
  })

  it("fails closed when the stored value does not match the confirmed prefix - never guesses ca_ vs acct_", () => {
    process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX = "acct_"
    try {
      resolveSpeedHeaderAccountId({ merchant_id: "merchant_1", speed_header_account_id: "ca_abc123" })
      throw new Error("expected resolveSpeedHeaderAccountId to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(SpeedHeaderAccountIdUnresolvedError)
      expect((error as SpeedHeaderAccountIdUnresolvedError).reason).toBe("prefix_mismatch")
    }
  })

  it("resolves only once both the stored value and the confirmed prefix agree", () => {
    process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX = "acct_"
    const resolved = resolveSpeedHeaderAccountId({
      merchant_id: "merchant_1",
      speed_header_account_id: "acct_xyz789",
    })
    expect(resolved).toBe("acct_xyz789")
  })

  it("carries the merchant id on the thrown error for diagnostics", () => {
    try {
      resolveSpeedHeaderAccountId({ merchant_id: "merchant_42", speed_header_account_id: null })
      throw new Error("expected resolveSpeedHeaderAccountId to throw")
    } catch (error) {
      expect((error as SpeedHeaderAccountIdUnresolvedError).merchantId).toBe("merchant_42")
    }
  })

  it("getConfiguredSpeedHeaderAccountIdPrefix returns null when unset", () => {
    delete process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX
    expect(getConfiguredSpeedHeaderAccountIdPrefix()).toBeNull()
  })

  it("getConfiguredSpeedHeaderAccountIdPrefix returns the trimmed configured value", () => {
    process.env.SPEED_HEADER_ACCOUNT_ID_PREFIX = "  ca_  "
    expect(getConfiguredSpeedHeaderAccountIdPrefix()).toBe("ca_")
  })
})
