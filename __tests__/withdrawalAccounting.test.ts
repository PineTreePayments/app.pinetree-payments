import { describe, expect, it } from "vitest"
import { calculateWithdrawalAccounting } from "@/engine/withdrawals/withdrawalAccounting"
import { calculateSpeedMaximumSendableSats } from "@/engine/withdrawals/speedWithdrawalQuote"

describe("canonical withdrawal accounting matrix", () => {
  it.each([
    { network: "Base", asset: "ETH", available: BigInt(1_000_000), pending: BigInt(100_000), fee: BigInt(21_000), max: BigInt(879_000) },
    { network: "Solana", asset: "SOL", available: BigInt(1_000_000), pending: BigInt(100_000), fee: BigInt(6_500), max: BigInt(893_500) },
  ])("reserves only the estimated fee for $asset on $network", ({ available, pending, fee, max }) => {
    expect(calculateWithdrawalAccounting({
      assetAvailableBaseUnits: available,
      assetPendingBaseUnits: pending,
      estimatedNetworkFeeBaseUnits: fee,
      assetIsNative: true,
    })).toMatchObject({
      spendableBaseUnits: max,
      maximumWithdrawalBaseUnits: max,
      requiredNativeBaseUnits: fee,
    })
  })

  it.each([
    { network: "Base", feeAsset: "ETH", fee: BigInt(21_000) },
    { network: "Solana", feeAsset: "SOL", fee: BigInt(6_500) },
  ])("keeps an exact USDC balance fully spendable on $network when $feeAsset is sufficient", ({ fee }) => {
    const quote = calculateWithdrawalAccounting({
      assetAvailableBaseUnits: BigInt(540_000),
      nativeAvailableBaseUnits: BigInt(6_767_866),
      estimatedNetworkFeeBaseUnits: fee,
      assetIsNative: false,
    })
    expect(quote.spendableBaseUnits).toBe(BigInt(540_000))
    expect(quote.maximumWithdrawalBaseUnits).toBe(BigInt(540_000))
    expect(quote.hasSufficientNativeFeeBalance).toBe(true)
  })

  it.each([
    { network: "Base", fee: BigInt(21_000) },
    { network: "Solana", fee: BigInt(6_500) },
  ])("reports missing native gas without reducing USDC on $network", ({ fee }) => {
    const quote = calculateWithdrawalAccounting({
      assetAvailableBaseUnits: BigInt(540_000),
      nativeAvailableBaseUnits: fee - BigInt(1),
      estimatedNetworkFeeBaseUnits: fee,
      assetIsNative: false,
    })
    expect(quote.spendableBaseUnits).toBe(BigInt(540_000))
    expect(quote.maximumWithdrawalBaseUnits).toBe(BigInt(0))
    expect(quote.hasSufficientNativeFeeBalance).toBe(false)
  })

  it("subtracts pending debits once and never below zero", () => {
    expect(calculateWithdrawalAccounting({
      assetAvailableBaseUnits: BigInt(540_000),
      assetPendingBaseUnits: BigInt(100_000),
      nativeAvailableBaseUnits: BigInt(1_000_000),
      estimatedNetworkFeeBaseUnits: BigInt(5_000),
      assetIsNative: false,
    }).maximumWithdrawalBaseUnits).toBe(BigInt(440_000))
    expect(calculateWithdrawalAccounting({
      assetAvailableBaseUnits: BigInt(100),
      assetPendingBaseUnits: BigInt(101),
      estimatedNetworkFeeBaseUnits: BigInt(1),
      assetIsNative: true,
    }).maximumWithdrawalBaseUnits).toBe(BigInt(0))
  })

  it("uses distinct canonical fee inputs for Bitcoin Lightning and on-chain Max", () => {
    process.env.SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS = "500"
    process.env.SPEED_ONCHAIN_WITHDRAWAL_FEE_BUFFER_SATS = "1000"
    const lightning = calculateSpeedMaximumSendableSats({ providerAvailableSats: BigInt(100_000), method: "lightning" })
    const onchain = calculateSpeedMaximumSendableSats({ providerAvailableSats: BigInt(100_000), method: "onchain" })
    expect(lightning.maximumSendableSats).toBe(BigInt(99_500))
    expect(onchain.maximumSendableSats).toBe(BigInt(99_000))
  })
})
