import type { WalletWithdrawalAsset, WalletWithdrawalRail } from "@/database/walletWithdrawalRequests"
import { fromBaseUnits } from "@/engine/withdrawals/decimalUnits"
import { calculateWithdrawalAccounting } from "@/engine/withdrawals/withdrawalAccounting"
import type { WalletApiErrorCode } from "@/engine/wallet/walletErrors"

export type WithdrawalPreflightFailureReason = "asset_balance" | "pending_balance" | "native_fee_balance" | "balance_unavailable" | "minimum_amount"

export type WithdrawalPreflightResult = {
  allowed: boolean
  code: WalletApiErrorCode | null
  title: string
  userMessage: string
  reason: WithdrawalPreflightFailureReason | null
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  network: "Base" | "Solana" | "Bitcoin" | "Bitcoin Lightning" | "Bitcoin / Lightning"
  requestedAmount: string
  availableBalance: string
  spendableBalance: string
  requiredFeeReserve: string
  feeAsset: "ETH" | "SOL" | "BTC"
  nativeAvailableBalance?: string
  verifiedAt: string
}

export type WithdrawalCapacity = {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  network: WithdrawalPreflightResult["network"]
  availableBaseUnits: bigint
  pendingBaseUnits: bigint
  feeBaseUnits: bigint
  feeAsset: "ETH" | "SOL" | "BTC"
  nativeAvailableBaseUnits?: bigint
  nativePendingBaseUnits?: bigint
  verifiedAt: string
}

export class WithdrawalPreflightError extends Error {
  readonly code: WalletApiErrorCode
  readonly status: number
  readonly retryable = false
  readonly preflight: WithdrawalPreflightResult

  constructor(preflight: WithdrawalPreflightResult) {
    super(preflight.userMessage)
    this.name = "WithdrawalPreflightError"
    this.code = preflight.code || "WALLET_VALIDATION_ERROR"
    this.status = this.code === "BALANCE_VERIFICATION_UNAVAILABLE" ? 503 : this.code === "MINIMUM_AMOUNT" ? 400 : 409
    this.preflight = preflight
  }
}

export function evaluateWithdrawalPreflight(input: {
  capacity: WithdrawalCapacity
  requestedBaseUnits: bigint
  minimumBaseUnits?: bigint
}): WithdrawalPreflightResult {
  const { capacity } = input
  const requested = input.requestedBaseUnits
  const minimum = input.minimumBaseUnits ?? BigInt(1)
  const accounting = calculateWithdrawalAccounting({
    assetAvailableBaseUnits: capacity.availableBaseUnits,
    assetPendingBaseUnits: capacity.pendingBaseUnits,
    nativeAvailableBaseUnits: capacity.nativeAvailableBaseUnits,
    nativePendingBaseUnits: capacity.nativePendingBaseUnits,
    estimatedNetworkFeeBaseUnits: capacity.feeBaseUnits,
    assetIsNative: capacity.asset === capacity.feeAsset,
  })
  let code: WalletApiErrorCode | null = null
  let reason: WithdrawalPreflightFailureReason | null = null
  let title = "Balance verified"
  let userMessage = "The wallet has enough spendable balance for this withdrawal."

  if (requested < minimum) {
    code = "MINIMUM_AMOUNT"
    reason = "minimum_amount"
    title = "Amount is below the minimum"
    userMessage = `Enter at least ${fromBaseUnits(minimum, capacity.asset)} ${capacity.asset}.`
  } else if (requested > accounting.spendableBaseUnits) {
    code = "INSUFFICIENT_BALANCE"
    const pendingReducesRequestedAvailability =
      capacity.pendingBaseUnits > BigInt(0) &&
      requested <= capacity.availableBaseUnits &&
      requested > accounting.assetAvailableAfterPendingBaseUnits
    reason = pendingReducesRequestedAvailability ? "pending_balance" : "asset_balance"
    title = "Insufficient balance"
    userMessage = pendingReducesRequestedAvailability
      ? `Pending ${capacity.asset} withdrawals reduce the spendable balance below this amount.`
      : capacity.asset === capacity.feeAsset
        ? `You do not have enough ${capacity.asset} to withdraw this amount and cover the network fee.`
        : `You do not have enough ${capacity.asset} for this withdrawal.`
  } else if (capacity.asset !== capacity.feeAsset && !accounting.hasSufficientNativeFeeBalance) {
    code = "INSUFFICIENT_NETWORK_FEE_BALANCE"
    reason = "native_fee_balance"
    title = "Insufficient network fee balance"
    userMessage = `You have enough ${capacity.asset}, but not enough ${capacity.feeAsset} to cover the ${capacity.network} network fee.`
  }

  return {
    allowed: code === null,
    code,
    title,
    userMessage,
    reason,
    rail: capacity.rail,
    asset: capacity.asset,
    network: capacity.network,
    requestedAmount: fromBaseUnits(requested, capacity.asset),
    availableBalance: fromBaseUnits(capacity.availableBaseUnits, capacity.asset),
    spendableBalance: fromBaseUnits(accounting.spendableBaseUnits, capacity.asset),
    requiredFeeReserve: fromBaseUnits(accounting.requiredNativeBaseUnits, capacity.feeAsset),
    feeAsset: capacity.feeAsset,
    ...(capacity.nativeAvailableBaseUnits !== undefined
      ? { nativeAvailableBalance: fromBaseUnits(capacity.nativeAvailableBaseUnits, capacity.feeAsset) }
      : {}),
    verifiedAt: capacity.verifiedAt,
  }
}

export function unavailableWithdrawalPreflight(input: {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  requestedAmount: string
}): WithdrawalPreflightResult {
  const network = input.rail === "base" ? "Base" : input.rail === "solana" ? "Solana" : "Bitcoin / Lightning"
  const feeAsset = input.rail === "base" ? "ETH" : input.rail === "solana" ? "SOL" : "BTC"
  return {
    allowed: false,
    code: "BALANCE_VERIFICATION_UNAVAILABLE",
    title: "Unable to verify available balance",
    userMessage: "We could not confirm the wallet's spendable balance. Please try again shortly.",
    reason: "balance_unavailable",
    rail: input.rail,
    asset: input.asset,
    network,
    requestedAmount: input.requestedAmount,
    availableBalance: "",
    spendableBalance: "",
    requiredFeeReserve: "",
    feeAsset,
    verifiedAt: new Date().toISOString(),
  }
}
