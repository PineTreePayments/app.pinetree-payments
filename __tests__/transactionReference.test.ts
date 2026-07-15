import { describe, expect, it } from "vitest"
import {
  formatProviderReference,
  formatTransactionReference
} from "@/app/dashboard/transactionReference"

describe("transaction reference formatting", () => {
  it.each([
    ["base", "0x36a1dcde", "Base Pay \u00b7 0x36a1dcde"],
    ["solana", "5WG3qBN7", "Solana Pay \u00b7 5WG3qBN7"],
    ["speed", "pi_mpx8q5fw1", "Bitcoin Lightning \u00b7 pi_mpx8q5fw1"],
    ["shift4", "abc123", "Shift4 \u00b7 abc123"]
  ])("labels %s references with the provider display name", (provider, reference, expected) => {
    expect(formatProviderReference(provider, reference)).toBe(expected)
  })

  it("uses the blockchain reference without shortening it", () => {
    const reference = "0x36a1dcde1234567890"

    expect(formatTransactionReference({
      id: "transaction-id",
      provider: "base",
      provider_transaction_id: reference
    })).toBe(`Base Pay \u00b7 ${reference}`)
  })

  it("preserves the existing shortened cash fallback", () => {
    expect(formatTransactionReference({
      id: "transaction-id",
      payment_id: "3a8ff702-e11a-1234",
      provider: "cash"
    })).toBe("Cash payment \u00b7 3a8ff702-e11...")
  })

  it("falls back without an empty separator when no reference exists", () => {
    expect(formatProviderReference("shift4", null)).toBe("Shift4")
    expect(formatProviderReference(null, "abc123")).toBe("abc123")
    expect(formatProviderReference(null, null)).toBeNull()
  })
})
