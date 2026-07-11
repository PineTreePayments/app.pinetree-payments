import { describe, expect, it } from "vitest"
import { classifyDynamicWalletCreationError } from "@/lib/wallets/dynamicWalletCreationError"

describe("classifyDynamicWalletCreationError", () => {
  it("Dynamic's own error classes never override .name, so it is sanitized but not treated as informative on its own", () => {
    const error = new Error("Failed to create wallet account for the following chains: EVM: No connector")
    const result = classifyDynamicWalletCreationError(error)
    expect(result.errorName).toBe("Error")
    expect(result.safeReason).toBe("wallet_creation_failed")
  })

  it("classifies the no-enabled-chains dashboard configuration message", () => {
    const error = new Error(
      "No enabled embedded wallet chains. Please go to the Dynamic Dashboard, select Embedded Wallets, and then click the gear icon on the top row to enable a new chain."
    )
    expect(classifyDynamicWalletCreationError(error).safeReason).toBe("no_enabled_chains")
  })

  it("classifies a missing WaaS connector", () => {
    const error = new Error("Dynamic Waas connector not found")
    expect(classifyDynamicWalletCreationError(error).safeReason).toBe("connector_not_found")
  })

  it("classifies invalid/not-enabled chains without leaking the appended chain list", () => {
    const error = new Error("The following chains are not enabled for embedded wallets: EVM")
    const result = classifyDynamicWalletCreationError(error)
    expect(result.safeReason).toBe("invalid_chains")
  })

  it("classifies a network/timeout-shaped message", () => {
    expect(classifyDynamicWalletCreationError(new Error("Network request timeout")).safeReason).toBe("network_error")
  })

  it("falls back to unknown for an unrecognized message and never echoes it", () => {
    const result = classifyDynamicWalletCreationError(new Error("some arbitrary provider-specific text"))
    expect(result.safeReason).toBe("unknown")
    expect(JSON.stringify(result)).not.toContain("arbitrary provider-specific text")
  })

  it("walks cause and cause.cause for code/status fields", () => {
    const inner = { name: "InnerError", code: "WAAS_TIMEOUT" }
    const middle = { name: "MiddleError", cause: inner, status: 503 }
    const outer = new Error("wrapped")
    Object.assign(outer, { cause: middle })
    const result = classifyDynamicWalletCreationError(outer)
    expect(result.errorCode).toBe("WAAS_TIMEOUT")
    expect(result.providerStatus).toBe(503)
  })

  it("sanitizes an overlong or non-enum-shaped code to null instead of passing it through", () => {
    const outer = Object.assign(new Error("x"), { code: "a".repeat(80) })
    expect(classifyDynamicWalletCreationError(outer).errorCode).toBeNull()
    const withSpaces = Object.assign(new Error("x"), { code: "not an enum; DROP TABLE" })
    expect(classifyDynamicWalletCreationError(withSpaces).errorCode).toBeNull()
  })

  it("never includes an email, address, JWT, or raw message in the classification output", () => {
    const error = new Error("failed for merchant m_12345 email test@example.com token abc.def.ghi")
    const result = classifyDynamicWalletCreationError(error)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("@example.com")
    expect(serialized).not.toContain("m_12345")
    expect(serialized).not.toContain("abc.def.ghi")
  })

  it("handles a non-Error thrown value without throwing itself", () => {
    expect(() => classifyDynamicWalletCreationError("plain string throw")).not.toThrow()
    expect(() => classifyDynamicWalletCreationError(undefined)).not.toThrow()
    expect(() => classifyDynamicWalletCreationError({ status: 500, statusCode: "abc" })).not.toThrow()
  })
})
