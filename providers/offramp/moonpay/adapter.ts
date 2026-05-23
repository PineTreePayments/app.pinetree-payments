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
  type OffRampDepositInstruction,
  type OffRampDepositInstructionInput,
  type OffRampProviderQuote,
  type OffRampProviderQuoteInput,
  type OffRampProviderSessionInput,
  type OffRampProviderSessionPreparation,
  type OffRampProviderWebhookEvent,
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

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const SECRET_KEY_PATTERN = /(secret|token|authorization|api[-_]?key|signature|password|bearer|webhook)/i

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]"

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizePayload(item, depth + 1))
  }

  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      clean[key] = SECRET_KEY_PATTERN.test(key)
        ? "[redacted]"
        : sanitizePayload(item, depth + 1)
    }
    return clean
  }

  return value
}

function safeRecordPayload(value: unknown): Record<string, unknown> {
  return asRecord(sanitizePayload(value))
}

function parseMoonPaySignatureHeader(signature: string | null | undefined): {
  timestamp: string | null
  signatures: string[]
} {
  const header = String(signature || "").trim()
  if (!header) return { timestamp: null, signatures: [] }

  const values: Record<string, string[]> = {}
  for (const part of header.split(",")) {
    const [rawKey, ...rawValue] = part.trim().split("=")
    const key = rawKey.trim().toLowerCase()
    const value = rawValue.join("=").trim()
    if (!key || !value) continue
    values[key] = [...(values[key] || []), value]
  }

  const timestamp = values.t?.[0] || values.timestamp?.[0] || null
  const signatures = [
    ...(values.s || []),
    ...(values.v1 || []),
    ...(values.signature || [])
  ]

  if (!timestamp && signatures.length === 0 && header) {
    return { timestamp: null, signatures: [header] }
  }

  return { timestamp, signatures }
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeMoonPayCode(code: string | null): {
  network: OffRampNetwork | null
  asset: OffRampAsset | null
} {
  const normalized = String(code || "").trim().toLowerCase()
  if (normalized === "sol") return { network: "solana", asset: "SOL" }
  if (normalized === "usdc_sol") return { network: "solana", asset: "USDC" }
  if (normalized === "eth_base") return { network: "base", asset: "ETH" }
  if (normalized === "usdc_base") return { network: "base", asset: "USDC" }
  return { network: null, asset: null }
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

  async getDepositInstructions(
    input: OffRampDepositInstructionInput
  ): Promise<OffRampDepositInstruction> {
    return {
      provider: "moonpay",
      providerSessionId: input.providerSessionId || null,
      externalTransactionId: input.externalTransactionId || null,
      network: input.network,
      asset: input.asset,
      amount: input.amount,
      depositAddress: null,
      memo: null,
      destinationTag: null,
      expiresAt: null,
      rawStatus: null,
      instructionReady: false,
      message:
        "MoonPay deposit instructions are not available until the MoonPay transaction status/webhook integration is implemented.",
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

  async verifyWebhookSignature(input: OffRampWebhookVerifyInput): Promise<boolean> {
    const config = getMoonPayClientConfig()
    const webhookSecret = String(config.webhookSecret || "").trim()
    if (!webhookSecret) {
      throw new OffRampProviderError(
        "MoonPay webhook verification requires MOONPAY_WEBHOOK_SECRET.",
        "OFF_RAMP_PROVIDER_DISABLED",
        503
      )
    }

    const { timestamp, signatures } = parseMoonPaySignatureHeader(input.signature)
    if (!timestamp || signatures.length === 0) return false

    const signedPayload = `${timestamp}.${input.payload}`
    const hexDigest = crypto.createHmac("sha256", webhookSecret).update(signedPayload).digest("hex")
    const base64Digest = crypto.createHmac("sha256", webhookSecret).update(signedPayload).digest("base64")

    return signatures.some((candidate) => {
      const normalized = String(candidate || "").trim()
      if (!normalized) return false
      return timingSafeEqualString(hexDigest, normalized) ||
        timingSafeEqualString(base64Digest, normalized)
    })
  },

  async normalizeTransactionStatus(input: unknown): Promise<OffRampProviderWebhookEvent> {
    const payload = typeof input === "string"
      ? JSON.parse(input) as Record<string, unknown>
      : asRecord(input)
    const data = asRecord(readPath(payload, ["data"]))
    const baseCurrency = asRecord(readPath(data, ["baseCurrency"]))
    const quoteCurrency = asRecord(readPath(data, ["quoteCurrency"]))
    const depositWallet = asRecord(readPath(data, ["depositWallet"]))
    const integratedSellDepositInfo = asRecord(readPath(data, ["integratedSellDepositInfo"]))
    const currencyCode =
      readString(readPath(baseCurrency, ["code"])) ||
      readString(readPath(data, ["baseCurrencyCode"]))
    const normalizedCurrency = normalizeMoonPayCode(currencyCode)
    const eventType =
      readString(readPath(payload, ["type"])) ||
      readString(readPath(payload, ["eventType"])) ||
      readString(readPath(payload, ["event"])) ||
      "moonpay.webhook.unknown"
    const providerEventId =
      readString(readPath(payload, ["id"])) ||
      readString(readPath(payload, ["eventId"]))
    const depositAddress =
      readString(readPath(depositWallet, ["address"])) ||
      readString(readPath(depositWallet, ["walletAddress"])) ||
      readString(readPath(integratedSellDepositInfo, ["depositWalletAddress"])) ||
      readString(readPath(data, ["depositWalletAddress"]))
    const memo =
      readString(readPath(depositWallet, ["memo"])) ||
      readString(readPath(integratedSellDepositInfo, ["memo"]))
    const destinationTag =
      readString(readPath(depositWallet, ["destinationTag"])) ||
      readString(readPath(depositWallet, ["tag"])) ||
      readString(readPath(integratedSellDepositInfo, ["destinationTag"]))
    const payoutStatus =
      readString(readPath(data, ["payoutStatus"])) ||
      readString(readPath(data, ["payout", "status"]))
    const paymentMethods = asArray(readPath(data, ["paymentMethods"]))
    const paymentMethodStatus = paymentMethods
      .map((item) => readString(readPath(item, ["status"])))
      .find(Boolean) || null

    return {
      provider: "moonpay",
      eventType,
      providerEventId,
      providerSessionId:
        readString(readPath(data, ["id"])) ||
        readString(readPath(data, ["transactionId"])),
      externalTransactionId: readString(readPath(data, ["externalTransactionId"])),
      providerStatus: readString(readPath(data, ["status"])) || paymentMethodStatus,
      sessionId: null,
      network: normalizedCurrency.network,
      asset: normalizedCurrency.asset,
      cryptoAmount: readNumber(readPath(data, ["baseCurrencyAmount"])),
      fiatAmount:
        readNumber(readPath(data, ["quoteCurrencyAmount"])) ||
        readNumber(readPath(data, ["fiatAmount"])),
      cryptoTxHash:
        readString(readPath(data, ["depositHash"])) ||
        readString(readPath(data, ["cryptoTxHash"])),
      depositAddress,
      memo,
      destinationTag,
      payoutStatus,
      rawPayloadSafe: {
        ...safeRecordPayload(payload),
        normalizedQuoteCurrency: readString(readPath(quoteCurrency, ["code"]))
      },
      verified: true
    }
  },

  async verifyWebhook(input: OffRampWebhookVerifyInput): Promise<boolean> {
    return this.verifyWebhookSignature(input)
  },

  async parseWebhookEvent(input: unknown): Promise<OffRampWebhookEvent> {
    const normalized = await this.normalizeTransactionStatus(input)
    return {
      provider: "moonpay",
      providerEventId: normalized.providerEventId,
      providerStatus: normalized.providerStatus,
      eventType: normalized.eventType,
      rawPayload: normalized.rawPayloadSafe
    }
  }
}
