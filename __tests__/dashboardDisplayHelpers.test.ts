import { describe, expect, it } from "vitest"
import {
  formatDashboardNetwork,
  formatTransactionSecondaryLabel
} from "@/components/dashboard/displayHelpers"

describe("transaction activity secondary labels", () => {
  it.each([
    ["base", "base", "Base"],
    ["solana", "solana", "Solana"],
    ["speed", "bitcoin_lightning", "Lightning"],
    ["cash", null, "USD"]
  ])("formats %s on %s as %s", (provider, network, expected) => {
    expect(formatTransactionSecondaryLabel(provider, network)).toBe(expected)
  })

  it("does not depend on a stored cash network value", () => {
    expect(formatTransactionSecondaryLabel("cash", "cash")).toBe("USD")
  })

  it("preserves USD capitalization in report summaries", () => {
    expect(formatDashboardNetwork("USD")).toBe("USD")
  })
})
