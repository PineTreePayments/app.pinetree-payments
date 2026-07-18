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

import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
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
  type SpeedInstantSendObject,
  type SpeedSwapObject,
} from "./speedWalletManagement"
import { WalletApiRouteError, type WalletApiErrorCode } from "@/engine/wallet/walletErrors"
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
import type { WalletOperationStatus } from "@/database/merchantWalletOperations"

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
    throw new WalletApiRouteError(
      codeByCategory[error.category] ?? "WALLET_PROVIDER_UNAVAILABLE",
      "Your wallet provider could not complete this request. Please try again.",
      error.retryable
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
  if (normalized === "pending") return "PENDING"
  if (!normalized) return "PROCESSING"
  return "PROCESSING"
}

function toAdapterOperationResult(payment: SpeedInstantSendObject): WalletAdapterOperationResult {
  return {
    providerReference: payment.id ?? null,
    providerStatus: payment.status ?? null,
    status: mapSpeedStatusToOperationStatus(payment.status),
    explorerUrl: payment.explorer_link ?? null,
    feeBaseUnits: Number.isFinite(payment.fees) ? BigInt(Math.round(payment.fees)) : null,
  }
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
  const profile = await getMerchantLightningProfile(merchantId)
  if (!profile) {
    return { configured: false, reason: "No Speed Custom Connect profile exists for this merchant." }
  }

  const providerAccountId = profile.speed_account_id?.trim() || null
  if (profile.status !== "ready" || !providerAccountId) {
    return { configured: true, ready: false, reason: "Speed Custom Connect setup is not complete yet." }
  }

  return { configured: true, ready: true, context: { merchantId, providerAccountId } }
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
        // Speed reports Bitcoin in SATS base units. PineTree keeps that raw
        // integer amount but exposes the merchant-facing asset as BTC with
        // eight decimals so the unified wallet never presents SATS as a
        // separate asset.
        asset: entry.target_currency === "SATS" ? "BTC" : entry.target_currency,
        availableBaseUnits: BigInt(Math.round(entry.amount)),
        pendingBaseUnits: BigInt(0),
        totalBaseUnits: BigInt(Math.round(entry.amount)),
        network: null,
        providerUpdatedAt: null,
      }))
    })
  },

  async createWithdrawal(context: WalletAdapterContext, input: WalletAdapterWriteInput) {
    return withTranslatedErrors(async () => {
      const payment = await createConnectedAccountWithdrawal({
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
