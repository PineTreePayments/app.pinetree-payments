/**
 * Speed Custom Connect implementation of the generic WalletProviderAdapter
 * contract (engine/wallet/walletProviderAdapter.ts). This is the ONLY file
 * allowed to know that "Speed" exists as a wallet provider - it is
 * registered by name in engine/wallet/loadWalletProviders.ts and every
 * caller above the engine layer only ever sees the generic adapter
 * interface, never this module directly.
 *
 * All actual Speed HTTP calls and fail-closed capability gating live in
 * speedWalletManagement.ts / speedWalletCapabilities.ts (unchanged) - this
 * file is purely a translation layer: PineTree generic types in, Speed raw
 * types out (and back).
 */

import {
  SpeedConnectedAccountContextError,
  resolveSpeedConnectedAccountContext,
} from "./speedConnectedAccountContext"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"
import { getSpeedWalletCapabilities } from "./speedWalletCapabilities"
import {
  SpeedWalletCapabilityUnavailableError,
  SpeedWalletProviderError,
  createConnectedAccountPayout,
  createConnectedAccountSwap,
  createConnectedAccountSwapQuote,
  createConnectedAccountWithdrawal,
  getConnectedAccountBalances,
  getConnectedAccountSendStatus,
  getConnectedAccountSwapStatus,
  listConnectedAccountTransactions,
  type SpeedInstantSendObject,
  type SpeedBalanceTransactionObject,
  type SpeedSwapObject,
} from "./speedWalletManagement"
import { WalletApiRouteError, type WalletApiErrorCode } from "@/engine/wallet/walletErrors"
import { WITHDRAWAL_ERROR_MESSAGES } from "@/engine/withdrawals/withdrawalErrorPresentation"
import type {
  WalletAdapterBalance,
  WalletAdapterContext,
  WalletAdapterOperationResult,
  WalletAdapterResolution,
  WalletAdapterSwapInput,
  WalletAdapterSwapQuoteInput,
  WalletAdapterWriteInput,
  WalletProviderAdapter,
} from "@/engine/wallet/walletProviderAdapter"
import type { PineTreeWalletSwapQuote } from "@/engine/wallet/walletTypes"
import type { WalletOperationStatus, WalletOperationType } from "@/database/merchantWalletOperations"

const PROVIDER = "speed"

/** Translates a Speed-layer error into a stable PineTree wallet error code - never lets a raw Speed error/message cross the adapter boundary. */
function translateSpeedWalletError(error: unknown): never {
  if (error instanceof SpeedWalletCapabilityUnavailableError) {
    throw new WalletApiRouteError(
      "WALLET_CAPABILITY_UNAVAILABLE",
      "This wallet operation is not currently supported by your connected provider.",
      false
    )
  }
  if (error instanceof SpeedWalletProviderError) {
    const codeByCategory: Record<string, WalletApiErrorCode> = {
      authentication: "WALLET_PROVIDER_AUTHENTICATION_ERROR",
      permission: "WALLET_PROVIDER_PERMISSION_ERROR",
      rate_limit: "WALLET_PROVIDER_RATE_LIMITED",
      provider_unavailable: "WALLET_PROVIDER_UNAVAILABLE",
      validation: "WALLET_VALIDATION_ERROR",
      unsupported_capability: "WALLET_CAPABILITY_UNAVAILABLE",
      unknown: "WALLET_PROVIDER_UNAVAILABLE",
    }
    // Speed's own message text is the only signal for *which* validation
    // failed - sharpen the generic "validation" category into a specific
    // code when the message clearly indicates destination/amount/balance,
    // rather than always surfacing the generic fallback copy.
    let code = error.providerCode === "timeout"
      ? error.outcomeUncertain
        ? "STATUS_UNKNOWN"
        : "WALLET_PROVIDER_TIMEOUT"
      : codeByCategory[error.category] ?? "WALLET_PROVIDER_UNAVAILABLE"
    if (error.category === "validation") {
      if (/insufficient|balance/i.test(error.message)) code = "INSUFFICIENT_BALANCE"
      else if (/destination|address|invoice/i.test(error.message)) code = "INVALID_DESTINATION"
      else if (/amount/i.test(error.message)) code = "INVALID_AMOUNT"
    }
    throw new WalletApiRouteError(
      code,
      code === "WALLET_VALIDATION_ERROR"
        ? "Your wallet provider could not complete this request. Please try again."
        : WITHDRAWAL_ERROR_MESSAGES[code],
      code === "STATUS_UNKNOWN" ? false : error.retryable
    )
  }
  if (error instanceof WalletApiRouteError) throw error
  throw new WalletApiRouteError("WALLET_PROVIDER_UNAVAILABLE", "Your wallet provider is temporarily unavailable.", true)
}

function mapSpeedStatusToOperationStatus(status: string | null | undefined): WalletOperationStatus {
  const normalized = String(status || "").trim().toLowerCase()
  if (normalized === "paid" || normalized === "completed" || normalized === "confirmed") return "COMPLETED"
  if (normalized === "failed") return "FAILED"
  if (normalized === "expired") return "EXPIRED"
  if (normalized === "canceled" || normalized === "cancelled") return "CANCELED"
  if (normalized === "pending" || normalized === "unpaid") return "PENDING"
  if (!normalized) return "PROCESSING"
  return "PROCESSING"
}

function toAdapterOperationResult(payment: SpeedInstantSendObject): WalletAdapterOperationResult {
  const fee = decimalToBaseUnits(payment.fees, payment.currency)
  return {
    providerReference: payment.id ?? null,
    providerStatus: payment.status ?? null,
    status: mapSpeedStatusToOperationStatus(payment.status),
    explorerUrl: payment.explorer_link ?? null,
    feeBaseUnits: fee,
    providerSecondaryReference: payment.withdraw_id ?? null,
    rawProviderStatus: {
      ...(payment.withdraw_id ? { withdrawId: payment.withdraw_id } : {}),
      ...(payment.failure_reason ? { failureReason: payment.failure_reason } : {}),
    },
  }
}

function decimalToBaseUnits(value: number | string, asset: string): bigint {
  const text = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Invalid provider amount")
  if (asset.toUpperCase() === "SATS") {
    const [whole, fraction = ""] = text.split(".")
    if (!fraction) return BigInt(whole)
    return fraction[0] >= "5" ? BigInt(whole) + BigInt(1) : BigInt(whole)
  }
  const decimals = 6
  const [whole, fraction = ""] = text.split(".")
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error("Provider amount exceeds supported precision")
  }
  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0")
}

function speedTransactionType(transaction: SpeedBalanceTransactionObject): WalletOperationType {
  const type = transaction.type.trim().toLowerCase()
  if (type === "payment") return "PAYMENT"
  if (type === "withdraw" || type === "withdrawal") return "WITHDRAWAL"
  if (type === "payout") return "PAYOUT"
  if (type === "transfer in") return "TRANSFER_IN"
  if (type === "transfer out") return "TRANSFER_OUT"
  if (type === "swap in") return "SWAP_IN"
  if (type === "swap out") return "SWAP_OUT"
  if (type.includes("fee")) return "APPLICATION_FEE"
  return "ADJUSTMENT"
}

function toAdapterSwapResult(swap: SpeedSwapObject): WalletAdapterOperationResult {
  return {
    providerReference: swap.id ?? null,
    providerStatus: swap.status ?? null,
    status: mapSpeedStatusToOperationStatus(swap.status),
    feeBaseUnits: swap.speed_fee?.amount != null ? BigInt(Math.round(swap.speed_fee.amount)) : null,
  }
}

function toWalletSwapQuote(input: {
  sourceAsset: string
  targetAsset: string
  amountBaseUnits: bigint
}, quote: {
  target_amount_swap_in: number
  exchange_rate_swap_in: number
  swap_quote_id: string
  swap_quote_expires_at: number
}): PineTreeWalletSwapQuote {
  return {
    sourceAsset: input.sourceAsset,
    targetAsset: input.targetAsset,
    sourceAmountBaseUnits: input.amountBaseUnits.toString(),
    targetAmountBaseUnits: String(Math.round(quote.target_amount_swap_in)),
    exchangeRate: Number.isFinite(quote.exchange_rate_swap_in) ? quote.exchange_rate_swap_in : null,
    expiresAt: quote.swap_quote_expires_at ? new Date(quote.swap_quote_expires_at).toISOString() : null,
    quoteReference: quote.swap_quote_id ?? null,
  }
}

async function resolveContext(merchantId: string): Promise<WalletAdapterResolution> {
  try {
    const context = await resolveSpeedConnectedAccountContext(merchantId)
    return { configured: true, ready: true, context: { merchantId, providerAccountId: context.connectedAccountId } }
  } catch (error) {
    if (error instanceof SpeedConnectedAccountContextError && error.code === "SPEED_PROFILE_MISSING") {
      return { configured: false, reason: "No Speed Custom Connect profile exists for this merchant." }
    }
    return { configured: true, ready: false, reason: "Speed connected-account identity is not configured safely." }
  }
}

async function withTranslatedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    translateSpeedWalletError(error)
  }
}

export const speedWalletAdapter: WalletProviderAdapter = {
  provider: PROVIDER,
  providerDisplayName: "Speed",
  requiresFreshBalanceForWithdrawal: true,

  validateWithdrawal(input) {
    if (input.asset !== "SATS") {
      throw new WalletApiRouteError("UNSUPPORTED_ASSET", "Bitcoin withdrawals must be denominated in SATS.")
    }
    if (input.amountBaseUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new WalletApiRouteError("MAXIMUM_AMOUNT", "Withdrawal amount is too large.")
    }
    // Bitcoin is one asset with two destination methods (Bitcoin Network
    // on-chain address, or Lightning via BOLT11/Lightning Address) - this
    // must accept both, never just Lightning-shaped destinations.
    const classified = classifyBitcoinWithdrawalDestination(input.destination)
    if (!classified.valid) {
      throw new WalletApiRouteError(
        "INVALID_DESTINATION",
        "Enter a valid Bitcoin address, Lightning Address, or Lightning invoice."
      )
    }
    // Speed's documented POST /send minimums (apidocs.tryspeed.com/reference/
    // create-a-instant-send): on-chain Bitcoin sends require at least 1000
    // SATS, Lightning sends at least 1 SAT. Enforced here so a below-minimum
    // amount returns the specific MINIMUM_AMOUNT code instead of depending on
    // Speed's raw validation error text being classified correctly after the
    // fact (translateSpeedWalletError's generic /amount/i check would
    // otherwise catch it as the less specific INVALID_AMOUNT).
    const minimumSats = classified.method === "onchain" ? BigInt(1000) : BigInt(1)
    if (input.amountBaseUnits < minimumSats) {
      throw new WalletApiRouteError(
        "MINIMUM_AMOUNT",
        classified.method === "onchain"
          ? "Bitcoin Network withdrawals require at least 1,000 sats."
          : "Lightning withdrawals require at least 1 sat."
      )
    }
  },

  resolveContext,

  async getCapabilities() {
    const { capabilities } = getSpeedWalletCapabilities()
    return {
      balances: capabilities.balances,
      withdrawals: capabilities.withdrawals,
      payouts: capabilities.payouts,
      swaps: capabilities.manualSwap,
      automaticPayouts: capabilities.automaticPayouts,
      automaticConversion: capabilities.automaticSwap,
    }
  },

  async getBalances(context: WalletAdapterContext): Promise<WalletAdapterBalance[]> {
    return withTranslatedErrors(async () => {
      const balance = await getConnectedAccountBalances({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
      })
      return balance.available.map((entry) => ({
        asset: entry.target_currency.toUpperCase() === "SATS" ? "BTC" : entry.target_currency.toUpperCase(),
        availableBaseUnits: decimalToBaseUnits(entry.amount, entry.target_currency),
        pendingBaseUnits: BigInt(0),
        totalBaseUnits: decimalToBaseUnits(entry.amount, entry.target_currency),
        network: entry.target_currency.toUpperCase() === "SATS" ? "bitcoin_lightning" : null,
        providerUpdatedAt: null,
      }))
    })
  },

  async listActivity(context, input) {
    return withTranslatedErrors(async () => {
      const page = await listConnectedAccountTransactions({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        cursor: input.cursor,
        limit: input.limit,
      })
      return {
        activity: page.data.map((transaction) => ({
          providerTransactionId: transaction.id,
          providerReference: transaction.source || null,
          operationType: speedTransactionType(transaction),
          direction: transaction.transaction_type === "debit" ? "debit" as const : "credit" as const,
          status: "COMPLETED" as const,
          providerStatus: transaction.type || null,
          asset: transaction.target_currency.toUpperCase(),
          network: transaction.target_currency.toUpperCase() === "SATS" ? "bitcoin_lightning" : null,
          amountBaseUnits: decimalToBaseUnits(transaction.amount, transaction.target_currency),
          feeBaseUnits: decimalToBaseUnits(transaction.fee, transaction.target_currency),
          providerCreatedAt: new Date(transaction.created).toISOString(),
        })),
        nextCursor: page.has_more ? page.data.at(-1)?.id ?? null : null,
      }
    })
  },

  async createWithdrawal(context: WalletAdapterContext, input: WalletAdapterWriteInput) {
    return withTranslatedErrors(async () => {
      input.diagnostics?.setSubstage?.("destination_classification")
      const classified = classifyBitcoinWithdrawalDestination(input.destination)
      if (!classified.valid) {
        throw new WalletApiRouteError(
          "INVALID_DESTINATION",
          "Enter a valid Bitcoin address, Lightning Address, or Lightning invoice."
        )
      }
      input.diagnostics?.setSubstage?.("send_request")
      const payment = await createConnectedAccountWithdrawal({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        amount: Number(input.amountBaseUnits),
        currency: "SATS",
        withdrawMethod: classified.method === "onchain" ? "onchain" : "lightning",
        withdrawRequest: classified.normalized,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        diagnostics: input.diagnostics,
      })
      return toAdapterOperationResult(payment)
    })
  },

  async getWithdrawalStatus(context: WalletAdapterContext, providerReference: string) {
    return withTranslatedErrors(async () => {
      const payment = await getConnectedAccountSendStatus({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        providerSendId: providerReference,
      })
      return toAdapterOperationResult(payment)
    })
  },

  async createPayout(context: WalletAdapterContext, input: WalletAdapterWriteInput) {
    return withTranslatedErrors(async () => {
      const payment = await createConnectedAccountPayout({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        amount: Number(input.amountBaseUnits),
        currency: input.asset as "SATS" | "USDT" | "USDC",
        withdrawMethod: input.asset === "SATS" ? "lightning" : "ethereum",
        withdrawRequest: input.destination,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
      })
      return toAdapterOperationResult(payment)
    })
  },

  async getPayoutStatus(context: WalletAdapterContext, providerReference: string) {
    return withTranslatedErrors(async () => {
      const payment = await getConnectedAccountSendStatus({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        providerSendId: providerReference,
      })
      return toAdapterOperationResult(payment)
    })
  },

  async quoteSwap(context: WalletAdapterContext, input: WalletAdapterSwapQuoteInput) {
    return withTranslatedErrors(async () => {
      const quote = await createConnectedAccountSwapQuote({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        currency: input.sourceAsset,
        amount: input.amountBaseUnits.toString(),
        targetCurrencySwapOut: input.sourceAsset,
        targetCurrencySwapIn: input.targetAsset,
      })
      return toWalletSwapQuote(input, quote)
    })
  },

  async createSwap(context: WalletAdapterContext, input: WalletAdapterSwapInput) {
    return withTranslatedErrors(async () => {
      const swap = await createConnectedAccountSwap({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        currency: input.sourceAsset,
        amount: input.amountBaseUnits.toString(),
        targetCurrencySwapOut: input.sourceAsset,
        targetCurrencySwapIn: input.targetAsset,
        idempotencyKey: input.idempotencyKey,
      })
      return toAdapterSwapResult(swap)
    })
  },

  async getSwapStatus(context: WalletAdapterContext, providerReference: string) {
    return withTranslatedErrors(async () => {
      const swap = await getConnectedAccountSwapStatus({
        merchantId: context.merchantId,
        speedAccountId: context.providerAccountId,
        providerSwapId: providerReference,
      })
      return toAdapterSwapResult(swap)
    })
  },
}
