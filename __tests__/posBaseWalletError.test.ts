import { describe, expect, it } from "vitest"
import { serializeWalletError } from "@/lib/pos/posBaseWalletError"

/**
 * Regression coverage for the "[object Object]" logging bug: production
 * logs for the failed EIP-3009 signature on payment
 * 54ca9536-a94d-438f-853c-dbd6ee089da8 showed `error: "[object Object]"`
 * because components/pos/POSLayout.tsx used to do
 * `eip3009Err instanceof Error ? eip3009Err.message : String(eip3009Err)` —
 * and WalletConnect providers commonly reject with a plain {code, message}
 * object, not an Error instance, which String() collapses to
 * "[object Object]". serializeWalletError must extract real fields instead.
 */

describe("serializeWalletError", () => {
  it("handles Error instances", () => {
    const err = new Error("Wallet did not return a valid EIP-3009 signature")
    err.name = "SignatureError"
    const result = serializeWalletError(err)
    expect(result.name).toBe("SignatureError")
    expect(result.message).toBe("Wallet did not return a valid EIP-3009 signature")
    expect(result.stack).not.toBeNull()
  })

  it("handles a plain WalletConnect JSON-RPC error object — never collapses to '[object Object]'", () => {
    const wcError = { code: 4001, message: "User rejected the request." }
    const result = serializeWalletError(wcError)
    expect(result.code).toBe(4001)
    expect(result.message).toBe("User rejected the request.")
    expect(JSON.stringify(result)).not.toContain("[object Object]")
  })

  it("handles a nested WalletConnect envelope (.error.code / .error.message)", () => {
    const wcError = { error: { code: -32601, message: "Method not found" } }
    const result = serializeWalletError(wcError)
    expect(result.code).toBe(-32601)
    expect(result.message).toBe("Method not found")
  })

  it("handles nested cause, data, and error fields", () => {
    const err = new Error("outer failure", {
      cause: { code: 4001, message: "user rejected" },
    })
    const result = serializeWalletError(err)
    expect(result.cause).not.toBeNull()
    expect(typeof result.cause).toBe("object")
    expect((result.cause as { code: number | string | null }).code).toBe(4001)
  })

  it("never throws — even for a circular object", () => {
    const circular: Record<string, unknown> = { message: "circular ref" }
    circular.self = circular
    expect(() => serializeWalletError(circular)).not.toThrow()
    const result = serializeWalletError(circular)
    expect(result.message).toBe("circular ref")
  })

  it("never throws for a bare primitive or null", () => {
    expect(() => serializeWalletError(null)).not.toThrow()
    expect(() => serializeWalletError(undefined)).not.toThrow()
    expect(() => serializeWalletError(42)).not.toThrow()
    expect(() => serializeWalletError("plain string error")).not.toThrow()
    expect(serializeWalletError("plain string error").message).toBe("plain string error")
  })

  it("does not reduce an unknown object with no message to String(error)", () => {
    const result = serializeWalletError({ weird: true, nested: { a: 1 } })
    expect(result.message).not.toBe("[object Object]")
    expect(result.message).toContain("weird")
  })

  it("redacts a full EVM address to a masked prefix/suffix", () => {
    const result = serializeWalletError({
      message: "failed",
      data: { payerAddress: "0x1234567890abcdef1234567890abcdef12345678" },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("0x1234567890abcdef1234567890abcdef12345678")
    expect(serialized).toContain("0x1234")
  })

  it("redacts a signature-length hex string", () => {
    const sig = "0x" + "a".repeat(130)
    const result = serializeWalletError({ message: "failed", data: { signature: sig } })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(sig)
  })

  it("redacts a WalletConnect URI", () => {
    const result = serializeWalletError({
      message: "wc:abc123@2?relay-protocol=irn&symKey=deadbeef failed to pair",
    })
    expect(result.message).not.toContain("symKey=deadbeef")
  })

  it("drops typed-data payload fields (domain/types/message body) from nested data", () => {
    const result = serializeWalletError({
      message: "failed",
      data: {
        domain: { name: "USDC", chainId: 8453 },
        types: { TransferWithAuthorization: [] },
        primaryType: "TransferWithAuthorization",
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("TransferWithAuthorization")
    expect(serialized).not.toContain('"USDC"')
  })

  it("attaches the provided context fields", () => {
    const result = serializeWalletError(new Error("failed"), {
      walletName: "MetaMask",
      walletFamily: "metamask",
      requestedMethod: "eth_signTypedData_v4",
      chainId: "0x2105",
      paymentId: "pay-1",
      intentId: "intent-1",
      attemptId: 5,
    })
    expect(result.walletName).toBe("MetaMask")
    expect(result.walletFamily).toBe("metamask")
    expect(result.requestedMethod).toBe("eth_signTypedData_v4")
    expect(result.chainId).toBe("0x2105")
    expect(result.paymentId).toBe("pay-1")
    expect(result.intentId).toBe("intent-1")
    expect(result.attemptId).toBe(5)
  })
})
