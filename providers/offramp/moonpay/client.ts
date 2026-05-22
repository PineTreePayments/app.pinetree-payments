import { OffRampProviderError } from "../types"

export type MoonPayClientConfig = {
  apiKey: string
  secretKey: string
  webhookSecret?: string | null
  baseUrl: string
  appUrl: string
}

export function getMoonPayClientConfig(): MoonPayClientConfig {
  const apiKey = String(process.env.MOONPAY_API_KEY || "").trim()
  const secretKey = String(process.env.MOONPAY_SECRET_KEY || "").trim()
  const webhookSecret = String(process.env.MOONPAY_WEBHOOK_SECRET || "").trim() || null
  const baseUrl = String(process.env.MOONPAY_BASE_URL || "https://api.moonpay.com")
    .trim()
    .replace(/\/+$/, "")
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "")
    .trim()
    .replace(/\/+$/, "")

  return {
    apiKey,
    secretKey,
    webhookSecret,
    baseUrl,
    appUrl
  }
}

export function assertMoonPayQuoteConfigured(config = getMoonPayClientConfig()) {
  if (!config.apiKey) {
    throw new OffRampProviderError(
      "MoonPay off-ramp quote support is not configured. Set MOONPAY_API_KEY.",
      "OFF_RAMP_PROVIDER_DISABLED",
      503
    )
  }
}

export function assertMoonPaySessionConfigured(config = getMoonPayClientConfig()) {
  assertMoonPayQuoteConfigured(config)

  if (!config.secretKey) {
    throw new OffRampProviderError(
      "MoonPay off-ramp session preparation is not configured. Set MOONPAY_SECRET_KEY.",
      "OFF_RAMP_PROVIDER_DISABLED",
      503
    )
  }

  if (!config.appUrl || !config.appUrl.startsWith("https://")) {
    throw new OffRampProviderError(
      "MoonPay off-ramp session preparation requires NEXT_PUBLIC_APP_URL to be a full HTTPS URL.",
      "OFF_RAMP_PROVIDER_DISABLED",
      503
    )
  }
}

export async function readMoonPayResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "")
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text.slice(0, 1200) }
  }
}

export function extractMoonPayErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "MoonPay API request failed"
  }

  const source = data as Record<string, unknown>
  const error = source.error
  if (typeof error === "string" && error.trim()) return error
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message
    }
  }

  if (typeof source.message === "string" && source.message.trim()) {
    return source.message
  }

  if (typeof source.raw === "string" && source.raw.trim()) {
    return source.raw
  }

  return "MoonPay API request failed"
}
