import { describe, expect, it } from "vitest"
import { formatTransactionSecondaryLabel } from "@/components/dashboard/displayHelpers"

describe("transaction activity secondary labels", () => {
  it.each([
    ["base", "base", "Base"],
    ["solana", "solana", "Solana"],
    ["speed", "bitcoin_lightning", "Lightning"],
    ["cash", null, "Manual"]
  ])("formats %s on %s as %s", (provider, network, expected) => {
    expect(formatTransactionSecondaryLabel(provider, network)).toBe(expected)
  })

  it("does not depend on a stored cash network value", () => {
    expect(formatTransactionSecondaryLabel("cash", "cash")).toBe("Manual")
  })
})
