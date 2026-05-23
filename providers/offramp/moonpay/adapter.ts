import crypto from "crypto"
import type { OffRampAsset, OffRampNetwork } from "@/engine/offRampOperations"
import {
  assertMoonPayQuoteConfigured,
  assertMoonPayWidgetConfigured,
  extractMoonPayErrorMessage,
  getMoonPayClientConfig,
  readMoonPayResponse
} from "./client"
import {
  OffRampProviderError,
  type OffRampProviderAdapter,
  type OffRampProviderQuote,
  type OffRampProviderQuoteInput,
  type OffRampProviderSessionInput,
  type OffRampProviderSessionPreparation,
  type OffRampProviderWidgetUrl,
  type OffRampProviderWidgetUrlInput,
  type OffRampSessionStatusInput,
  type OffRampWebhookEvent,
  type OffRampWebhookVerifyInput
} from "../types"

function readNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function getMoonPayCode(network: OffRampNetwork, asset: OffRampAsset): string | null {
  if (network === "solana" && asset === "USDC") return "usdc_sol"
  if (network === "solana" && asset === "SOL") return "sol"
  if (network === "base" && asset === "USDC") return "usdc_base"
  if (network === "base" && asset === "ETH") return "eth_base"
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function appendIfPresent(url: URL, key: string, value: string | number | null | undefined) {
  const normalized = String(value ?? "").trim()
  if (normalized) {
    url.searchParams.set(key, normalized)
  }
}

function signWidgetUrl(url: URL, secretKey: string): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(url.search)
    .digest("base64")
}

export const moonPayOffRampAdapter: OffRampProviderAdapter = {
  provider: "moonpay",

  supportsAsset(input) {
    return Boolean(getMoonPayCode(input.network, input.asset))
  },

  supportsRegion(input) {
    const merchantState = String(input.merchantState || "").trim().toUpperCase()
    if (merchantState === "NY" && input.network === "base") {
      return {
        supported: false,
        reason: "Base network cash-out may not be available for New York residents through MoonPay."
      }
    }

    return { supported: true }
  },

  async getQuote(input: OffRampProviderQuoteInput): Promise<OffRampProviderQuote> {
    const moonPayCode = getMoonPayCode(input.network, input.asset)
    if (!moonPayCode) {
      throw new OffRampProviderError(
        "This asset and network are not supported for MoonPay cash-out yet.",
        "OFF_RAMP_PROVIDER_UNSUPPORTED",
        400
      )
    }

    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new OffRampProviderError(
        "Invalid MoonPay quote amount.",
        "OFF_RAMP_PROVIDER_REQUEST_FAILED",
        400
      )
    }

    const config = getMoonPayClientConfig()
    assertMoonPayQuoteConfigured(config)

    const fiatCurrency = String(input.fiatCurrency || "USD").trim().toUpperCase()
    const payoutMethod = String(input.payoutMethod || "ach_bank_transfer").trim()
    const extraFeePercentage = Math.max(0, Number(input.extraFeePercentage ?? 0) || 0)
    const url = new URL(`/v3/currencies/${encodeURIComponent(moonPayCode)}/sell_quote`, config.baseUrl)

    url.searchParams.set("apiKey", config.apiKey)
    url.searchParams.set("baseCurrencyAmount", String(amount))
    url.searchParams.set("quoteCurrencyCode", fiatCurrency)
    url.searchParams.set("paymentMethod", payoutMethod)
    url.searchParams.set("extraFeePercentage", String(extraFeePercentage))

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    })
    const data = await readMoonPayResponse(response)

    if (!response.ok) {
      throw new OffRampProviderError(
        `MoonPay sell quote failed (${response.status}): ${extractMoonPayErrorMessage(data)}`,
        response.status === 401 || response.status === 403
          ? "OFF_RAMP_PROVIDER_DISABLED"
          : "OFF_RAMP_PROVIDER_REQUEST_FAILED",
        response.status === 401 || response.status === 403 ? 503 : 400
      )
    }

    const quoteFiatAmount = readNumber(readPath(data, ["quoteCurrencyAmount"]))
    const providerFeeAmount = readNumber(readPath(data, ["feeAmount"]))
    const platformFeeAmount = readNumber(readPath(data, ["extraFeeAmount"])) ?? 0
    const totalFeeAmount =
      providerFeeAmount == null && platformFeeAmount == null
        ? null
        : Number(providerFeeAmount || 0) + Number(platformFeeAmount || 0)
    const quoteExpiresAt = readPath(data, ["expiresAt"])

    return {
      provider: "moonpay",
      moonPayCode,
      asset: input.asset,
      network: input.network,
      cryptoAmount: readNumber(readPath(data, ["baseCurrencyAmount"])) ?? amount,
      fiatCurrency: String(readPath(data, ["quoteCurrencyCode"]) || fiatCurrency).toUpperCase(),
      quoteFiatAmount,
      providerFeeAmount,
      platformFeeAmount,
      totalFeeAmount,
      payoutMethod: String(readPath(data, ["payoutMethod"]) || payoutMethod),
      quoteExpiresAt: typeof quoteExpiresAt === "string" ? quoteExpiresAt : null,
      rawProviderResponse: asRecord(data)
    }
  },

  async createSession(input: OffRampProviderSessionInput): Promise<OffRampProviderSessionPreparation> {
    void input
    throw new OffRampProviderError(
      "MoonPay sell session creation is not implemented in this phase. Quote preparation is available, but PineTree will not create a provider transaction or move funds yet.",
      "OFF_RAMP_PROVIDER_NOT_IMPLEMENTED",
      501
    )
  },

  async createWidgetUrl(input: OffRampProviderWidgetUrlInput): Promise<OffRampProviderWidgetUrl> {
    const config = getMoonPayClientConfig()
    assertMoonPayWidgetConfigured(config)

    const amount = Number(input.cryptoAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new OffRampProviderError(
        "Invalid MoonPay widget amount.",
        "OFF_RAMP_PROVIDER_REQUEST_FAILED",
        400
      )
    }

    const redirectUrl = String(input.redirectUrl || "").trim()
    if (!redirectUrl || !redirectUrl.startsWith("https://")) {
      throw new OffRampProviderError(
        "MoonPay widget launch requires a full HTTPS redirect URL.",
        "OFF_RAMP_PROVIDER_DISABLED",
        503
      )
    }

    const url = new URL("/", config.widgetBaseUrl)
    url.searchParams.set("apiKey", config.apiKey)
    url.searchParams.set("baseCurrencyCode", input.moonPayCode)
    url.searchParams.set("baseCurrencyAmount", String(amount))
    url.searchParams.set("quoteCurrencyCode", String(input.fiatCurrency || "USD").trim().toUpperCase())
    url.searchParams.set("lockAmount", "true")
    url.searchParams.set("externalTransactionId", input.sessionId)
    url.searchParams.set("redirectURL", redirectUrl)
    appendIfPresent(url, "paymentMethod", input.payoutMethod)
    appendIfPresent(url, "email", input.merchantEmail)

    const refundWalletAddress = String(input.refundWalletAddress || "").trim()
    if (refundWalletAddress) {
      url.searchParams.set("refundWalletAddress", refundWalletAddress)
    }

    const signed = Boolean(config.secretKey && (refundWalletAddress || input.merchantEmail))
    if ((refundWalletAddress || input.merchantEmail) && !config.secretKey) {
      throw new OffRampProviderError(
        "MoonPay widget launch with prefilled sensitive fields requires MOONPAY_SECRET_KEY.",
        "OFF_RAMP_PROVIDER_DISABLED",
        503
      )
    }

    if (signed) {
      url.searchParams.set("signature", signWidgetUrl(url, config.secretKey))
    }

    return {
      provider: "moonpay",
      widgetUrl: url.toString(),
      signed,
      expiresAt: null,
      fundMovementEnabled: false
    }
  },

  async getSessionStatus(input: OffRampSessionStatusInput): Promise<OffRampProviderSessionPreparation> {
    void input
    throw new OffRampProviderError(
      "MoonPay sell session status polling is reserved for the webhook/status phase.",
      "OFF_RAMP_PROVIDER_NOT_IMPLEMENTED",
      501
    )
  },

  async verifyWebhook(input: OffRampWebhookVerifyInput): Promise<boolean> {
    void input
    return false
  },

  async parseWebhookEvent(input: unknown): Promise<OffRampWebhookEvent> {
    return {
      provider: "moonpay",
      eventType: "off_ramp.webhook.unimplemented",
      rawPayload: asRecord(input)
    }
  }
}
