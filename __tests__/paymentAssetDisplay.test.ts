import { describe, expect, it } from "vitest"
import { getPaymentAssetDisplay } from "@/lib/paymentAssetDisplay"

describe("getPaymentAssetDisplay", () => {
  // ── SOL ─────────────────────────────────────────────────────────────────────

  it("SOL with quotePriceUsd shows rate label", () => {
    const result = getPaymentAssetDisplay(
      "solana",
      { selectedAsset: "SOL", split: { expectedAmountNative: 0.00074, quotePriceUsd: 229.45, nativeSymbol: "SOL" } },
      0.17
    )
    expect(result.assetLabel).toBe("SOL")
    expect(result.amountPaidLabel).toBe("0.00074 SOL")
    expect(result.rateLabel).toBe("1 SOL = $229.45 USD")
    expect(result.networkLabel).toBe("Solana")
  })

  it("SOL with missing quotePriceUsd returns null rateLabel (old transaction)", () => {
    const result = getPaymentAssetDisplay(
      "solana",
      { selectedAsset: "SOL", split: { expectedAmountNative: 0.00074 } },
      0.17
    )
    expect(result.assetLabel).toBe("SOL")
    expect(result.amountPaidLabel).toBe("0.00074 SOL")
    expect(result.rateLabel).toBeNull()
  })

  // ── ETH ─────────────────────────────────────────────────────────────────────

  it("ETH with quotePriceUsd shows rate label", () => {
    const result = getPaymentAssetDisplay(
      "base",
      { selectedAsset: "ETH", split: { expectedAmountNative: 0.0001, quotePriceUsd: 1700, nativeSymbol: "ETH" } },
      0.17
    )
    expect(result.assetLabel).toBe("ETH")
    expect(result.amountPaidLabel).toBe("0.0001 ETH")
    expect(result.rateLabel).toBe("1 ETH = $1,700.00 USD")
    expect(result.networkLabel).toBe("Base")
  })

  it("ETH with missing quotePriceUsd returns null rateLabel (old transaction)", () => {
    const result = getPaymentAssetDisplay(
      "base",
      { selectedAsset: "ETH", split: { expectedAmountNative: 0.0001 } },
      0.17
    )
    expect(result.assetLabel).toBe("ETH")
    expect(result.rateLabel).toBeNull()
  })

  // ── USDC ─────────────────────────────────────────────────────────────────────

  it("USDC on Solana shows 1 USDC = $1.00 USD", () => {
    const result = getPaymentAssetDisplay(
      "solana",
      { selectedAsset: "USDC", split: { expectedAmountNative: 0.17, quotePriceUsd: 1, nativeSymbol: "USDC" } },
      0.17
    )
    expect(result.assetLabel).toBe("USDC")
    expect(result.amountPaidLabel).toBe("0.17 USDC")
    expect(result.rateLabel).toBe("1 USDC = $1.00 USD")
  })

  it("USDC on Base shows stablecoin rate", () => {
    const result = getPaymentAssetDisplay(
      "base",
      { selectedAsset: "USDC", split: { expectedAmountNative: 0.17, quotePriceUsd: 1, nativeSymbol: "USDC" } },
      0.17
    )
    expect(result.assetLabel).toBe("USDC")
    expect(result.amountPaidLabel).toBe("0.17 USDC")
    expect(result.rateLabel).toBe("1 USDC = $1.00 USD")
    expect(result.networkLabel).toBe("Base")
  })

  it("USDC stablecoin rate is shown even without quotePriceUsd", () => {
    const result = getPaymentAssetDisplay("base", { selectedAsset: "USDC", split: {} }, 0.17)
    expect(result.assetLabel).toBe("USDC")
    expect(result.rateLabel).toBe("1 USDC = $1.00 USD")
  })

  // ── BTC / Lightning ──────────────────────────────────────────────────────────

  it("BTC NWC: shows sats and rate from lightningProviderMetadata", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      {
        selectedAsset: "BTC",
        split: { lightningProviderMetadata: { amountSats: 421, btcPriceUsd: 40380 } }
      },
      0.17
    )
    expect(result.assetLabel).toBe("BTC")
    expect(result.amountPaidLabel).toBe("421 sats")
    expect(result.rateLabel).toBe("1 BTC = $40,380.00 USD")
    expect(result.networkLabel).toBe("Bitcoin Lightning")
  })

  it("BTC Speed (new): shows rate from split.quotePriceUsd when no lightningProviderMetadata.btcPriceUsd", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      {
        selectedAsset: "BTC",
        split: {
          quotePriceUsd: 65000,
          lightningProviderMetadata: { grossAmount: 0.17 }
        }
      },
      0.17
    )
    expect(result.assetLabel).toBe("BTC")
    expect(result.rateLabel).toBe("1 BTC = $65,000.00 USD")
    // Speed has no amountSats
    expect(result.amountPaidLabel).toBeNull()
  })

  it("BTC Speed (old): no rate when neither btcPriceUsd nor quotePriceUsd stored", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      {
        selectedAsset: "BTC",
        split: { lightningProviderMetadata: { grossAmount: 0.17, merchantAmount: 0.02 } }
      },
      0.17
    )
    expect(result.assetLabel).toBe("BTC")
    expect(result.amountPaidLabel).toBeNull()
    expect(result.rateLabel).toBeNull()
  })

  it("lightningProviderMetadata.btcPriceUsd takes precedence over split.quotePriceUsd", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      {
        split: {
          quotePriceUsd: 50000,
          lightningProviderMetadata: { amountSats: 421, btcPriceUsd: 40380 }
        }
      },
      0.17
    )
    expect(result.rateLabel).toBe("1 BTC = $40,380.00 USD")
  })

  it("formats large sats amounts with thousands separator", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      { split: { lightningProviderMetadata: { amountSats: 123456, btcPriceUsd: 65000 } } },
      80.25
    )
    expect(result.amountPaidLabel).toBe("123,456 sats")
  })

  // ── Non-crypto rails ─────────────────────────────────────────────────────────

  it("returns null asset for Cash", () => {
    const result = getPaymentAssetDisplay("cash", null, 10)
    expect(result.assetLabel).toBeNull()
    expect(result.amountPaidLabel).toBeNull()
    expect(result.rateLabel).toBeNull()
  })

  it("returns null asset for Shift4", () => {
    const result = getPaymentAssetDisplay("shift4", null, 10)
    expect(result.assetLabel).toBeNull()
  })

  // ── Old / missing data ────────────────────────────────────────────────────────

  it("handles null metadata gracefully", () => {
    const result = getPaymentAssetDisplay("solana", null, 0.17)
    expect(result.assetLabel).toBeNull()
    expect(result.amountPaidLabel).toBeNull()
    expect(result.rateLabel).toBeNull()
  })

  it("handles unknown network gracefully", () => {
    const result = getPaymentAssetDisplay("coinbase", { selectedAsset: "USD" }, 10)
    expect(result.assetLabel).toBeNull()
  })

  it("falls back to selectedAsset when nativeSymbol absent", () => {
    const result = getPaymentAssetDisplay(
      "base",
      { selectedAsset: "ETH", split: { expectedAmountNative: 0.0001 } },
      0.17
    )
    expect(result.assetLabel).toBe("ETH")
  })
})
