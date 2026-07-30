import { clampNonNegative } from "@/engine/withdrawals/decimalUnits"

export type WithdrawalAccountingInput = {
  assetAvailableBaseUnits: bigint
  assetPendingBaseUnits?: bigint
  nativeAvailableBaseUnits?: bigint
  nativePendingBaseUnits?: bigint
  estimatedNetworkFeeBaseUnits: bigint
  assetIsNative: boolean
}

export type WithdrawalAccounting = {
  assetAvailableAfterPendingBaseUnits: bigint
  nativeAvailableAfterPendingBaseUnits: bigint
  requiredNativeBaseUnits: bigint
  spendableBaseUnits: bigint
  maximumWithdrawalBaseUnits: bigint
  hasSufficientNativeFeeBalance: boolean
}

const SUPPORTED_WITHDRAWAL_ASSETS: Record<"base" | "solana" | "bitcoin", readonly string[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

export function isSupportedWithdrawalPair(rail: string, asset: string): boolean {
  const supported = SUPPORTED_WITHDRAWAL_ASSETS[rail as keyof typeof SUPPORTED_WITHDRAWAL_ASSETS]
  return Boolean(supported?.includes(asset.toUpperCase()))
}

/**
 * The one accounting rule for every withdrawal rail.
 *
 * Balances and fees must already be expressed in their assets' integer base
 * units. A native withdrawal pays its estimated network cost from the same
 * balance. A token withdrawal never pays native gas from the token balance;
 * it remains fully spendable after pending token debits, while native-gas
 * sufficiency is reported independently.
 */
export function calculateWithdrawalAccounting(input: WithdrawalAccountingInput): WithdrawalAccounting {
  const pendingAsset = clampNonNegative(input.assetPendingBaseUnits ?? BigInt(0))
  const pendingNative = clampNonNegative(input.nativePendingBaseUnits ?? BigInt(0))
  const requiredNativeBaseUnits = clampNonNegative(input.estimatedNetworkFeeBaseUnits)
  const assetAvailableAfterPendingBaseUnits = clampNonNegative(input.assetAvailableBaseUnits - pendingAsset)
  const nativeAvailableAfterPendingBaseUnits = clampNonNegative(
    (input.nativeAvailableBaseUnits ?? input.assetAvailableBaseUnits) - pendingNative
  )
  const hasSufficientNativeFeeBalance = nativeAvailableAfterPendingBaseUnits >= requiredNativeBaseUnits
  const spendableBaseUnits = input.assetIsNative
    ? clampNonNegative(assetAvailableAfterPendingBaseUnits - requiredNativeBaseUnits)
    : assetAvailableAfterPendingBaseUnits

  return {
    assetAvailableAfterPendingBaseUnits,
    nativeAvailableAfterPendingBaseUnits,
    requiredNativeBaseUnits,
    spendableBaseUnits,
    maximumWithdrawalBaseUnits:
      input.assetIsNative || hasSufficientNativeFeeBalance ? spendableBaseUnits : BigInt(0),
    hasSufficientNativeFeeBalance,
  }
}
