/**
 * Authoritative, spendable Max calculation shared with withdrawal preflight.
 * All arithmetic stays in integer base units; displayed decimals are derived
 * only after fees, pending debits, and reserves have been subtracted.
 */

import { sumPendingWithdrawalOperationBaseUnits } from "@/database/merchantWalletOperations"
import type { WalletWithdrawalAsset, WalletWithdrawalRail } from "@/database/walletWithdrawalRequests"
import { clampNonNegative, fromBaseUnits } from "@/engine/withdrawals/decimalUnits"
import { calculateSpeedMaximumSendableSats } from "@/engine/withdrawals/speedWithdrawalQuote"
import { resolveAuthoritativeWithdrawalCapacity } from "@/engine/withdrawals/withdrawalPreflight"
import type { WithdrawalCapacity } from "@/engine/withdrawals/withdrawalPreflightResult"
import { getWalletBalances as getAuthoritativeWalletBalances } from "@/engine/wallet/walletOperations"

export type MaxWithdrawalEstimate = {
  maxDecimal: string
  feeEstimateDecimal: string
  feeAsset: string
  blocked?: boolean
  warning?: string
}

export async function estimateMaxWithdrawalAmount(
  merchantId: string,
  rail: WalletWithdrawalRail,
  asset: WalletWithdrawalAsset
): Promise<MaxWithdrawalEstimate> {
  if (rail === "bitcoin") {
    const balances = await getAuthoritativeWalletBalances(merchantId)
    if (balances.syncStatus !== "live") {
      throw Object.assign(new Error("Unable to verify available balance."), {
        status: 503,
        code: "BALANCE_VERIFICATION_UNAVAILABLE",
      })
    }
    const providerAvailableSats = BigInt(
      balances.balances.find((balance) => balance.asset === "BTC")?.availableBaseUnits || "0"
    )
    const pendingSats = await sumPendingWithdrawalOperationBaseUnits(merchantId, "SATS")
    const quote = calculateSpeedMaximumSendableSats({
      providerAvailableSats,
      pendingSats,
      method: "lightning",
    })
    console.info("[pinetree-withdrawals] SPEED_MAX_CALCULATED", {
      merchantId,
      totalAvailableSats: quote.totalAvailableSats.toString(),
      pendingSats: quote.pendingSats.toString(),
      estimatedFeeSats: quote.estimatedFeeSats.toString(),
      maximumSendableSats: quote.maximumSendableSats.toString(),
      routeStage: "speed_max_calculated",
    })
    return {
      maxDecimal: fromBaseUnits(quote.maximumSendableSats, "BTC"),
      feeEstimateDecimal: fromBaseUnits(quote.estimatedFeeSats, "BTC"),
      feeAsset: "BTC",
      warning: "Bitcoin's exact network fee is set at send time - this Max leaves a small buffer as an estimate.",
    }
  }

  let capacity: WithdrawalCapacity
  try {
    capacity = await resolveAuthoritativeWithdrawalCapacity({
      merchantId,
      rail,
      asset: asset as "ETH" | "USDC" | "SOL",
    })
  } catch {
    return {
      maxDecimal: "0",
      feeEstimateDecimal: "0",
      feeAsset: rail === "base" ? "ETH" : "SOL",
      blocked: true,
      warning: "Unable to verify available balance. Please try again shortly.",
    }
  }

  const nativeAvailable = clampNonNegative(
    (capacity.nativeAvailableBaseUnits ?? capacity.availableBaseUnits) -
      (capacity.nativePendingBaseUnits ?? BigInt(0))
  )
  const requiredNative = capacity.feeBaseUnits + capacity.reserveBaseUnits
  if (capacity.asset !== capacity.feeAsset && nativeAvailable < requiredNative) {
    return {
      maxDecimal: "0",
      feeEstimateDecimal: fromBaseUnits(requiredNative, capacity.feeAsset),
      feeAsset: capacity.feeAsset,
      blocked: true,
      warning: `This wallet does not currently have enough ${capacity.feeAsset} on ${capacity.network} to cover the network fee for this ${asset} withdrawal.`,
    }
  }
  return {
    maxDecimal: fromBaseUnits(capacity.spendableBaseUnits, capacity.asset),
    feeEstimateDecimal: fromBaseUnits(requiredNative, capacity.feeAsset),
    feeAsset: capacity.feeAsset,
  }
}
