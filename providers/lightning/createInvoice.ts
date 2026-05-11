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

export function buildSpeedCreatePaymentRequest(input: {
  paymentId: string
  merchantId: string
  merchantAmount: number
  pinetreeFee: number
  grossAmount: number
  currency: string
  speedAccountId: string
  merchantLightningAddress: string
}): SpeedCreatePaymentRequest {
  const grossAmount = Number(input.grossAmount)
  const merchantAmount = Number(input.merchantAmount)
  const merchantTransferPercentage =
    grossAmount > 0
      ? Math.max(0, Math.min(100, Number(((merchantAmount / grossAmount) * 100).toFixed(8))))
      : 0

  return {
    currency: input.currency || "USD",
    amount: grossAmount,
    target_currency: "SATS",
    payment_methods: ["lightning"],
    description: `PineTree payment ${input.paymentId}`,
    metadata: {
      pineTreePaymentId: input.paymentId,
      merchantId: input.merchantId,
      merchantAmount,
      pineTreeFee: Number(input.pinetreeFee),
      grossAmount,
      speedAccountId: input.speedAccountId,
      merchantLightningAddress: input.merchantLightningAddress,
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
): Promise<{ speedAccountId: string; lightningAddress: string } | null> {
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
    const providerModel = String(creds.provider_model || "").trim()

    if (providerModel !== "speed_merchant_account") return null
    if (!speedAccountId || !lightningAddress) return null
    return { speedAccountId, lightningAddress }
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
    merchantLightningAddress
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

  const response = await fetch(`${normalizeApiBaseUrl(config.apiBaseUrl)}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      readPath(data, ["message"]) ||
      readPath(data, ["error", "message"]) ||
      "Speed Create Payment API error"
    throw new Error(String(message))
  }

  return parseSpeedPaymentResponse(data)
}

export async function buildLightningQrCode(invoice: string): Promise<string> {
  const normalizedInvoice = String(invoice || "").trim()
  const invoiceUri = normalizedInvoice.toLowerCase().startsWith("lightning:")
    ? normalizedInvoice
    : `lightning:${normalizedInvoice}`

  return QRCode.toDataURL(invoiceUri)
}
