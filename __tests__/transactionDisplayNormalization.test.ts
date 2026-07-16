import { describe, expect, it } from "vitest"
import {
  normalizeTransactionAsset,
  resolveLifecycleDisplayStatus
} from "@/lib/transactionDisplay"

describe("transaction display normalization", () => {
  it.each([
    ["solana", "solana", "USDC", "USDC"],
    ["solana", "solana", "SOL", "SOL"],
    ["base", "base", "ETH", "ETH"],
    ["base", "base", "USDC", "USDC"],
    ["speed", "bitcoin_lightning", null, "BTC"],
    ["stripe", "stripe", null, "USD"],
    ["cash", null, null, "USD"]
  ])("normalizes %s / %s to %s", (provider, network, selectedAsset, expected) => {
    expect(normalizeTransactionAsset({
      provider,
      network,
      currency: "USD",
      metadata: selectedAsset ? { selectedAsset } : null
    })).toBe(expected)
  })

  it("returns Unknown asset instead of using the network as an asset", () => {
    expect(normalizeTransactionAsset({ provider: "solana", network: "solana" })).toBe("Unknown asset")
  })

  it("distinguishes canceled and expired evidence with a canceled fallback", () => {
    expect(resolveLifecycleDisplayStatus("INCOMPLETE", [{ event_type: "payment.cancelled" }])).toBe("CANCELED")
    expect(resolveLifecycleDisplayStatus("INCOMPLETE", [{ event_type: "payment.canceled" }])).toBe("CANCELED")
    expect(resolveLifecycleDisplayStatus("INCOMPLETE", [{ event_type: "payment.expired" }])).toBe("EXPIRED")
    expect(resolveLifecycleDisplayStatus("INCOMPLETE", [{ event_type: "payment.incomplete" }])).toBe("CANCELED")
  })
})
