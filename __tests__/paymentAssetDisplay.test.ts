import { describe, expect, it } from "vitest"
import { getPaymentAssetDisplay } from "@/lib/paymentAssetDisplay"

describe("getPaymentAssetDisplay", () => {
  it("shows Asset SOL and amount/rate for Solana SOL payment", () => {
    const result = getPaymentAssetDisplay(
      "solana",
      {
        selectedAsset: "SOL",
        split: { expectedAmountNative: 0.00074, quotePriceUsd: 229.45, nativeSymbol: "SOL" }
      },
      0.17
    )
    expect(result.assetLabel).toBe("SOL")
    expect(result.amountPaidLabel).toBe("0.00074 SOL")
    expect(result.rateLabel).toBe("1 SOL = $229.45 USD")
    expect(result.networkLabel).toBe("Solana")
  })

  it("shows Asset USDC and stablecoin rate for Solana USDC payment", () => {
    const result = getPaymentAssetDisplay(
      "solana",
      {
        selectedAsset: "USDC",
        split: { expectedAmountNative: 0.17, quotePriceUsd: 1, nativeSymbol: "USDC" }
      },
      0.17
    )
    expect(result.assetLabel).toBe("USDC")
    expect(result.amountPaidLabel).toBe("0.17 USDC")
    expect(result.rateLabel).toBe("1 USDC = $1.00 USD")
  })

  it("shows Asset ETH and amount/rate for Base ETH payment", () => {
    const result = getPaymentAssetDisplay(
      "base",
      {
        selectedAsset: "ETH",
        split: { expectedAmountNative: 0.0001, quotePriceUsd: 1700, nativeSymbol: "ETH" }
      },
      0.17
    )
    expect(result.assetLabel).toBe("ETH")
    expect(result.amountPaidLabel).toBe("0.0001 ETH")
    expect(result.rateLabel).toBe("1 ETH = $1,700.00 USD")
    expect(result.networkLabel).toBe("Base")
  })

  it("shows Asset USDC and stablecoin rate for Base USDC payment", () => {
    const result = getPaymentAssetDisplay(
      "base",
      {
        selectedAsset: "USDC",
        split: { expectedAmountNative: 0.17, quotePriceUsd: 1, nativeSymbol: "USDC" }
      },
      0.17
    )
    expect(result.assetLabel).toBe("USDC")
    expect(result.amountPaidLabel).toBe("0.17 USDC")
    expect(result.rateLabel).toBe("1 USDC = $1.00 USD")
    expect(result.networkLabel).toBe("Base")
  })

  it("shows Asset BTC and sats/rate for Lightning NWC payment", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      {
        selectedAsset: "BTC",
        split: {
          lightningProviderMetadata: {
            amountSats: 421,
            btcPriceUsd: 40380
          }
        }
      },
      0.17
    )
    expect(result.assetLabel).toBe("BTC")
    expect(result.amountPaidLabel).toBe("421 sats")
    expect(result.rateLabel).toBe("1 BTC = $40,380.00 USD")
    expect(result.networkLabel).toBe("Bitcoin Lightning")
  })

  it("shows Asset BTC with no amount for Speed Lightning (no sats in metadata)", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      {
        selectedAsset: "BTC",
        split: {
          lightningProviderMetadata: {
            grossAmount: 0.17,
            merchantAmount: 0.02
          }
        }
      },
      0.17
    )
    expect(result.assetLabel).toBe("BTC")
    expect(result.amountPaidLabel).toBeNull()
    expect(result.rateLabel).toBeNull()
  })

  it("does not fake rate when quotePriceUsd is missing (old transaction)", () => {
    const result = getPaymentAssetDisplay(
      "solana",
      { selectedAsset: "SOL", split: { expectedAmountNative: 0.00074 } },
      0.17
    )
    expect(result.assetLabel).toBe("SOL")
    expect(result.amountPaidLabel).toBe("0.00074 SOL")
    expect(result.rateLabel).toBeNull()
  })

  it("falls back to selectedAsset when nativeSymbol is absent (old transactions)", () => {
    const result = getPaymentAssetDisplay(
      "base",
      { selectedAsset: "ETH", split: { expectedAmountNative: 0.0001 } },
      0.17
    )
    expect(result.assetLabel).toBe("ETH")
  })

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

  it("handles null metadata gracefully for old transactions", () => {
    const result = getPaymentAssetDisplay("solana", null, 0.17)
    expect(result.assetLabel).toBeNull()
    expect(result.amountPaidLabel).toBeNull()
    expect(result.rateLabel).toBeNull()
  })

  it("handles unknown/unsupported network gracefully", () => {
    const result = getPaymentAssetDisplay("coinbase", { selectedAsset: "USD" }, 10)
    expect(result.assetLabel).toBeNull()
  })

  it("formats large sats amounts with thousands separator", () => {
    const result = getPaymentAssetDisplay(
      "bitcoin_lightning",
      { split: { lightningProviderMetadata: { amountSats: 123456, btcPriceUsd: 65000 } } },
      80.25
    )
    expect(result.amountPaidLabel).toBe("123,456 sats")
  })

  it("USDC stablecoin rate is always shown regardless of quotePriceUsd", () => {
    const result = getPaymentAssetDisplay(
      "base",
      { selectedAsset: "USDC", split: {} },
      0.17
    )
    expect(result.assetLabel).toBe("USDC")
    expect(result.rateLabel).toBe("1 USDC = $1.00 USD")
  })
})
