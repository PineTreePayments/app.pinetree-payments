import { describe, expect, it } from "vitest"
import { classifyBaseUsdcSigningError } from "@/lib/pos/baseUsdcSigningErrorClassifier"

/**
 * Regression coverage for the Base USDC EIP-3009 fix: production payment
 * 54ca9536-a94d-438f-853c-dbd6ee089da8 failed eth_signTypedData_v4 with the
 * generic wallet message "Failed to sign message", and the POS flow treated
 * "not a rejection" as sufficient proof to auto-fallback to the allowance
 * two-step (a second, then a third, wallet prompt). This classifier must
 * only ever return "method_unsupported" for conclusive evidence — every
 * other non-rejection outcome (including that exact message) must be
 * "unknown" so the caller stops instead of guessing.
 */

describe("classifyBaseUsdcSigningError", () => {
  it("code 4001 -> user_rejected", () => {
    expect(classifyBaseUsdcSigningError({ code: 4001, message: "User rejected." })).toBe("user_rejected")
  })

  it('"User rejected the request" -> user_rejected', () => {
    expect(classifyBaseUsdcSigningError(new Error("User rejected the request."))).toBe("user_rejected")
  })

  it('"denied" -> user_rejected', () => {
    expect(classifyBaseUsdcSigningError(new Error("Signature request denied by user"))).toBe("user_rejected")
  })

  it('"cancelled" -> user_rejected', () => {
    expect(classifyBaseUsdcSigningError(new Error("Request was cancelled"))).toBe("user_rejected")
  })

  it("code -32601 -> method_unsupported", () => {
    expect(classifyBaseUsdcSigningError({ code: -32601, message: "Method not found" })).toBe(
      "method_unsupported"
    )
  })

  it('"method not supported" -> method_unsupported', () => {
    expect(classifyBaseUsdcSigningError(new Error("eth_signTypedData_v4 method not supported"))).toBe(
      "method_unsupported"
    )
  })

  it("malformed typed-data errors -> typed_data_invalid", () => {
    expect(classifyBaseUsdcSigningError(new Error("Invalid typed data: missing domain"))).toBe(
      "typed_data_invalid"
    )
    expect(classifyBaseUsdcSigningError({ code: -32602, message: "invalid params" })).toBe(
      "typed_data_invalid"
    )
  })

  it("chain mismatch -> chain_or_account_mismatch", () => {
    expect(classifyBaseUsdcSigningError(new Error("Chain mismatch: wallet is on a different chain"))).toBe(
      "chain_or_account_mismatch"
    )
    expect(classifyBaseUsdcSigningError({ code: 4901, message: "unrecognized chain" })).toBe(
      "chain_or_account_mismatch"
    )
  })

  it("disconnected session -> session_disconnected", () => {
    expect(classifyBaseUsdcSigningError(new Error("Session disconnected before responding"))).toBe(
      "session_disconnected"
    )
    expect(classifyBaseUsdcSigningError(new Error("No matching key. session topic doesn't exist"))).toBe(
      "session_disconnected"
    )
  })

  it("timeout -> timeout", () => {
    expect(classifyBaseUsdcSigningError(new Error("Timed out waiting for wallet to respond"))).toBe("timeout")
  })

  it("unknown object -> unknown", () => {
    expect(classifyBaseUsdcSigningError({ foo: "bar" })).toBe("unknown")
    expect(classifyBaseUsdcSigningError(42)).toBe("unknown")
    expect(classifyBaseUsdcSigningError(null)).toBe("unknown")
  })

  it("the exact production failure message ('Failed to sign message', no code) -> unknown, NOT method_unsupported", () => {
    expect(classifyBaseUsdcSigningError(new Error("Failed to sign message"))).toBe("unknown")
  })

  it("nested WalletConnect error objects: code/message under .error, .data, and .cause are inspected", () => {
    expect(classifyBaseUsdcSigningError({ error: { code: 4001, message: "rejected" } })).toBe("user_rejected")
    expect(classifyBaseUsdcSigningError({ data: { code: -32601, message: "unsupported" } })).toBe(
      "method_unsupported"
    )
    expect(
      classifyBaseUsdcSigningError(
        new Error("wrapper", { cause: { code: -32601, message: "method not found" } })
      )
    ).toBe("method_unsupported")
  })

  it("a numeric code wins over an ambiguous or misleading message", () => {
    // A wallet that sends code 4001 alongside a generic message must still
    // classify as user_rejected — codes are the definitive signal.
    expect(classifyBaseUsdcSigningError({ code: 4001, message: "Failed to sign message" })).toBe(
      "user_rejected"
    )
  })

  it("transport/network errors -> transport_error", () => {
    expect(classifyBaseUsdcSigningError(new Error("Failed to fetch"))).toBe("transport_error")
    expect(classifyBaseUsdcSigningError(new Error("WebSocket connection closed"))).toBe("transport_error")
  })
})
