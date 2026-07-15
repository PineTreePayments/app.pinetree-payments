import { describe, expect, it } from "vitest"
import {
  formatDashboardNetwork,
  formatTransactionSecondaryLabel
} from "@/components/dashboard/displayHelpers"

describe("transaction activity secondary labels", () => {
  it.each([
    ["base", "base", { metadata: { selectedAsset: "ETH" } }, "ETH"],
    ["base", "base", { metadata: { selectedAsset: "USDC" } }, "USDC"],
    ["solana", "solana", { metadata: { selectedAsset: "SOL" } }, "SOL"],
    ["solana", "solana", { metadata: { selectedAsset: "USDC" } }, "USDC"],
    ["speed", "bitcoin_lightning", null, "BTC"],
    ["stripe", "stripe", { currency: "USD" }, "USD"],
    ["cash", null, { currency: "USD" }, "USD"]
  ])("formats %s on %s as %s", (provider, network, payment, expected) => {
    expect(formatTransactionSecondaryLabel(provider, network, payment)).toBe(expected)
  })

  it("does not silently substitute a crypto network for a missing asset", () => {
    expect(formatTransactionSecondaryLabel("solana", "solana", null)).toBe("Unknown asset")
  })

  it("does not depend on a stored cash network value", () => {
    expect(formatTransactionSecondaryLabel("cash", "cash")).toBe("USD")
  })

  it("preserves USD capitalization in report summaries", () => {
    expect(formatDashboardNetwork("USD")).toBe("USD")
  })
})
