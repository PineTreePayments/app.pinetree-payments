import QRCode from "qrcode"
import type {
  CreateLightningInvoiceInput,
  CreateLightningInvoiceResult,
  LightningProviderConfig,
  SpeedCreatePaymentRequest
} from "./types"

const SPEED_SPLIT_SETTLEMENT_UNSUPPORTED_ERROR =
  "Speed Lightning split settlement is not wired yet. Confirm Speed transfers[] destination_account behavior before enabling live payments."

export class LightningCapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LightningCapabilityError"
  }
}

export function assertLightningFeeCaptureSupported(
  config: LightningProviderConfig
): void {
  const capabilities = config.capabilities

  if (!config.providerKey) {
    throw new LightningCapabilityError(
      "Speed platform is not configured. Set SPEED_API_KEY. SPEED_API_BASE_URL defaults to https://api.tryspeed.com."
    )
  }

  if (!config.webhookSecret || !capabilities.supportsWebhookConfirmation) {
    throw new LightningCapabilityError(
      "Speed webhook confirmation is not configured. Set SPEED_WEBHOOK_SECRET before enabling Bitcoin Lightning."
    )
  }

  if (!capabilities.supportsLightningInvoice) {
    throw new LightningCapabilityError(
      "Speed Lightning invoice capability is unavailable. Check SPEED_API_KEY and SPEED_WEBHOOK_SECRET."
    )
  }

  if (!capabilities.supportsFeeAtPaymentTime || !capabilities.supportsSplitSettlement) {
    throw new LightningCapabilityError(SPEED_SPLIT_SETTLEMENT_UNSUPPORTED_ERROR)
  }
}

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    if (Array.isArray(cursor)) {
      const index = Number(key)
      if (!Number.isInteger(index)) return undefined
      cursor = cursor[index]
    } else {
      cursor = (cursor as Record<string, unknown>)[key]
    }
  }
  return cursor
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return toIsoTimestamp(numeric)
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString()
  }

  return undefined
}

function normalizeApiBaseUrl(value?: string): string {
  return String(value || "https://api.tryspeed.com").replace(/\/+$/, "")
}

function buildSpeedAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
}

function roundSpeedPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  const bounded = Math.max(0, Math.min(100, value))
  return Number(bounded.toFixed(8))
}

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForLog)

  if (!value || typeof value !== "object") return value

  const sanitized: Record<string, unknown> = {}
  const secretKeys = new Set([
    "authorization",
    "api_key",
    "apikey",
    "providerkey",
    "secret",
    "webhook_secret",
    "signature"
  ])

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "")
    sanitized[key] = secretKeys.has(normalizedKey) ? "[redacted]" : sanitizeForLog(entry)
  }

  return sanitized
}

async function readSpeedResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "")
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 1200) }
  }
}

function extractSpeedErrorMessage(data: unknown): string {
  const message =
    readPath(data, ["message"]) ||
    readPath(data, ["error", "message"]) ||
    readPath(data, ["errors", "0", "message"]) ||
    readPath(data, ["error_description"]) ||
    readPath(data, ["raw"])

  return String(message || "Speed Create Payment API error").trim()
}

export function buildSpeedCreatePaymentRequest(input: {
  paymentId: string
  merchantId: string
  merchantAmount: number
  pinetreeFee: number
  grossAmount: number
  currency: string
  speedAccountId: string
  merchantLightningAddress: string
  paymentAddressId?: string
}): SpeedCreatePaymentRequest {
  const grossAmount = Number(input.grossAmount)
  const merchantAmount = Number(input.merchantAmount)
  const pineTreeFee = Number(input.pinetreeFee)

  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    throw new Error("Invalid Speed payment amount: grossAmount must be greater than zero.")
  }

  if (!Number.isFinite(merchantAmount) || merchantAmount < 0) {
    throw new Error("Invalid Speed payment amount: merchantAmount must be zero or greater.")
  }

  if (!Number.isFinite(pineTreeFee) || pineTreeFee < 0) {
    throw new Error("Invalid Speed payment amount: pineTreeFee must be zero or greater.")
  }

  const merchantTransferPercentage =
    roundSpeedPercentage((merchantAmount / grossAmount) * 100)

  return {
    currency: String(input.currency || "USD").toUpperCase(),
    amount: grossAmount,
    target_currency: "SATS",
    payment_methods: ["lightning"],
    description: `PineTree payment ${input.paymentId}`,
    metadata: {
      pineTreePaymentId: input.paymentId,
      merchantId: input.merchantId,
      merchantAmount,
      pineTreeFee,
      grossAmount,
      speedAccountId: input.speedAccountId,
      merchantLightningAddress: input.merchantLightningAddress,
      paymentAddressId: input.paymentAddressId || undefined,
      settlementMode: "speed_merchant_account",
      feeCaptureMethod: "invoice_split",
      provider: "speed",
      network: "bitcoin_lightning"
    },
    transfers: [
      {
        destination_account: input.speedAccountId,
        percentage: merchantTransferPercentage,
        description: `PineTree merchant settlement ${input.paymentId}`
      }
    ]
  }
}

export async function parseSpeedPaymentResponse(
  raw: unknown
): Promise<CreateLightningInvoiceResult> {
  const providerReference = String(readPath(raw, ["id"]) || "").trim()
  const invoice = String(
    readPath(raw, ["payment_method_options", "lightning", "payment_request"]) ||
    readPath(raw, ["payment_request"]) ||
    readPath(raw, ["lightning", "payment_request"]) ||
    readPath(raw, ["invoice"]) ||
    ""
  ).trim()
  const hostedUrl = String(
    readPath(raw, ["url"]) ||
    readPath(raw, ["default_url"]) ||
    readPath(raw, ["hosted_url"]) ||
    ""
  ).trim()
  const paymentHash = String(
    readPath(raw, ["payment_hash"]) ||
    readPath(raw, ["payment_method_options", "lightning", "payment_hash"]) ||
    readPath(raw, ["lightning", "payment_hash"]) ||
    ""
  ).trim() || undefined
  const expiresAt = toIsoTimestamp(readPath(raw, ["expires_at"]))
  const paymentUrl = invoice || hostedUrl

  if (!providerReference) {
    throw new Error("Invalid Speed payment response: missing payment id")
  }

  if (!paymentUrl) {
    throw new Error("Invalid Speed payment response: missing Lightning invoice or hosted payment URL")
  }

  return {
    providerReference,
    invoice: invoice || hostedUrl,
    paymentHash,
    paymentUrl,
    qrCodeUrl: invoice
      ? await buildLightningQrCode(invoice)
      : await QRCode.toDataURL(hostedUrl),
    expiresAt,
    feeCaptureMethod: "invoice_split",
    metadata: {
      speedPayment: raw as Record<string, unknown>
    }
  }
}

async function getMerchantSpeedSetup(
  merchantId: string
): Promise<{ speedAccountId: string; lightningAddress: string; paymentAddressId?: string } | null> {
  try {
    const { supabaseAdmin, supabase } = await import("@/database/supabase")
    const db = supabaseAdmin || supabase

    const { data } = await db
      .from("merchant_providers")
      .select("credentials")
      .eq("merchant_id", merchantId)
      .eq("provider", "lightning")
      .in("status", ["connected", "active"])
      .maybeSingle()

    if (!data?.credentials) return null

    const creds = data.credentials as Record<string, unknown>
    const speedAccountId = String(creds.speed_account_id || "").trim()
    const lightningAddress = String(creds.lightning_address || "").trim()
    const paymentAddressId = String(creds.payment_address_id || "").trim()
    const providerModel = String(creds.provider_model || "").trim()

    if (providerModel !== "speed_merchant_account") return null
    if (!speedAccountId || !lightningAddress) return null
    return { speedAccountId, lightningAddress, paymentAddressId: paymentAddressId || undefined }
  } catch {
    return null
  }
}

export async function createLightningInvoice(
  input: CreateLightningInvoiceInput,
  config: LightningProviderConfig
): Promise<CreateLightningInvoiceResult> {
  assertLightningFeeCaptureSupported(config)

  if (!config.apiBaseUrl || !config.providerKey) {
    throw new Error(
      "Speed Lightning platform is not configured. " +
      "Set SPEED_API_KEY before enabling Bitcoin Lightning. SPEED_API_BASE_URL defaults to https://api.tryspeed.com."
    )
  }

  const merchantSetup = await getMerchantSpeedSetup(input.merchantId)
  const speedAccountId = merchantSetup?.speedAccountId || ""
  const merchantLightningAddress =
    input.merchantLightningAddress ||
    merchantSetup?.lightningAddress ||
    ""
  const paymentAddressId = merchantSetup?.paymentAddressId || ""

  if (!speedAccountId) {
    throw new Error(
      "Merchant Speed Account ID is not configured. " +
      "The merchant must save a Speed Account ID before accepting Bitcoin Lightning payments."
    )
  }

  if (!merchantLightningAddress) {
    throw new Error(
      "Merchant Lightning Address is not configured. " +
      "The merchant must save a verified Lightning Address before accepting Bitcoin Lightning payments."
    )
  }

  const body = buildSpeedCreatePaymentRequest({
    paymentId: input.paymentId,
    merchantId: input.merchantId,
    merchantAmount: input.merchantAmount,
    pinetreeFee: input.pinetreeFee,
    grossAmount: input.grossAmount,
    currency: input.currency,
    speedAccountId,
    merchantLightningAddress,
    paymentAddressId
  })

  // Speed documents transfers[] with destination_account pointing to an existing
  // Speed account. PineTree never places arbitrary Lightning Addresses in this
  // field; the merchant Lightning Address is stored only as verified setup
  // metadata and as a merchant-facing receive reference.
  if (!config.speedAccountTransfersSupported) {
    void body
    throw new Error(SPEED_SPLIT_SETTLEMENT_UNSUPPORTED_ERROR)
  }

  const headers: Record<string, string> = {
    "Authorization": buildSpeedAuthHeader(config.providerKey),
    "Content-Type": "application/json",
    "speed-version": "2022-10-15"
  }

  if (config.platformAccountId) {
    headers["speed-account"] = config.platformAccountId
  }

  console.info("[lightning/speed] create payment request", sanitizeForLog(body))

  const response = await fetch(`${normalizeApiBaseUrl(config.apiBaseUrl)}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  })

  const data = await readSpeedResponseBody(response)
  if (!response.ok) {
    console.error("[lightning/speed] create payment failed", {
      status: response.status,
      body: sanitizeForLog(data)
    })

    const message = extractSpeedErrorMessage(data)
    throw new Error(`Speed Create Payment API error (${response.status}): ${message}`)
  }

  console.info("[lightning/speed] create payment response", {
    status: response.status,
    body: sanitizeForLog(data)
  })

  return parseSpeedPaymentResponse(data)
}

export async function buildLightningQrCode(invoice: string): Promise<string> {
  const normalizedInvoice = String(invoice || "").trim()
  const invoiceUri = normalizedInvoice.toLowerCase().startsWith("lightning:")
    ? normalizedInvoice
    : `lightning:${normalizedInvoice}`

  return QRCode.toDataURL(invoiceUri)
}
