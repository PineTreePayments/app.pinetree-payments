import QRCode from "qrcode"
import type {
  CreateLightningInvoiceInput,
  CreateLightningInvoiceResult,
  LightningProviderConfig,
  SpeedCreatePaymentRequest
} from "./types"
import {
  getSpeedAccountBalanceDiagnostics,
  maskSpeedAccountId,
  type SpeedBalanceDiagnostics
} from "./getBalance"

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

function isDevelopment() {
  return process.env.NODE_ENV === "development"
}

function envFlag(name: string): boolean {
  return String(process.env[name] || "").toLowerCase().trim() === "true"
}

function formatSpeedPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  const bounded = Math.max(0, Math.min(100, value))
  return Number(bounded.toFixed(2))
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
  const accountKeys = new Set([
    "speedaccountid",
    "speed_account_id",
    "settlementaccountid",
    "settlement_account_id",
    "destinationaccount",
    "destination_account"
  ])

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "")
    sanitized[key] = secretKeys.has(normalizedKey)
      ? "[redacted]"
      : accountKeys.has(normalizedKey)
        ? maskSpeedAccountId(String(entry || ""))
        : sanitizeForLog(entry)
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
  includeTransfers?: boolean
  settlementAccountId?: string
  settlementAccountSource?: "db_credentials" | "platform_account_fallback"
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
    formatSpeedPercentage((merchantAmount / grossAmount) * 100)
  const includeTransfers = input.includeTransfers !== false
  const settlementAccountId = String(input.settlementAccountId || input.speedAccountId || "").trim()
  const settlementMode = includeTransfers
    ? "speed_merchant_account"
    : "speed_platform_account_fallback"

  const request: SpeedCreatePaymentRequest = {
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
      settlementAccountId: settlementAccountId || undefined,
      settlementAccountSource: input.settlementAccountSource || (includeTransfers ? "db_credentials" : "platform_account_fallback"),
      merchantLightningAddress: input.merchantLightningAddress,
      paymentAddressId: input.paymentAddressId || undefined,
      settlementMode,
      feeCaptureMethod: "invoice_split",
      provider: "speed",
      network: "bitcoin_lightning"
    },
    transfers: includeTransfers && settlementAccountId ? [
      {
        destination_account: settlementAccountId,
        percentage: merchantTransferPercentage,
        description: `PineTree merchant settlement ${input.paymentId}`
      }
    ] : undefined
  }

  if (!request.transfers) {
    delete request.transfers
  }

  return request
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

function resolveInvoiceAccount(args: {
  merchantSetup: { speedAccountId: string; accountSource: "db_credentials" }
  balance: SpeedBalanceDiagnostics
}): {
  speedAccountId: string
  includeTransfers: boolean
  settlementAccountId?: string
  settlementAccountSource: "db_credentials" | "platform_account_fallback"
} {
  if (args.balance.balanceSource === "merchant_account") {
    return {
      speedAccountId: args.merchantSetup.speedAccountId,
      includeTransfers: true,
      settlementAccountId: args.merchantSetup.speedAccountId,
      settlementAccountSource: args.merchantSetup.accountSource
    }
  }

  if (args.balance.balanceSource === "platform_account_fallback") {
    return {
      speedAccountId: args.merchantSetup.speedAccountId,
      includeTransfers: false,
      settlementAccountSource: "platform_account_fallback"
    }
  }

  return {
    speedAccountId: args.merchantSetup.speedAccountId,
    includeTransfers: true,
    settlementAccountId: args.merchantSetup.speedAccountId,
    settlementAccountSource: args.merchantSetup.accountSource
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

  // Merchant Speed setup is resolved by the engine (database layer) and passed in.
  // The provider adapter does not query the database directly.
  const speedAccountId = String(input.speedAccountId || "").trim()
  const merchantLightningAddress = String(input.merchantLightningAddress || "").trim()
  const paymentAddressId = String(input.lightningPaymentAddressId || "").trim()

  if (!speedAccountId || !merchantLightningAddress) {
    throw new Error("Lightning provider setup is incomplete for this merchant.")
  }

  const balance = await getSpeedAccountBalanceDiagnostics(speedAccountId)
  const invoiceAccount = resolveInvoiceAccount({
    merchantSetup: { speedAccountId, accountSource: "db_credentials" },
    balance
  })

  console.info("[lightning/speed] invoice account selection", {
    paymentId: input.paymentId,
    merchantId: input.merchantId,
    speedAccountIdMasked: maskSpeedAccountId(speedAccountId),
    invoiceAccountIdMasked: invoiceAccount.settlementAccountId
      ? maskSpeedAccountId(invoiceAccount.settlementAccountId)
      : "",
    invoiceAccountSource: invoiceAccount.settlementAccountSource,
    balanceAccountIdMasked: balance.speedAccountIdMasked,
    balanceSource: balance.balanceSource,
    merchantContextStatus: balance.merchantContextStatus,
    platformFallbackStatus: balance.platformFallbackStatus,
    includeTransfers: invoiceAccount.includeTransfers
  })

  const body = buildSpeedCreatePaymentRequest({
    paymentId: input.paymentId,
    merchantId: input.merchantId,
    merchantAmount: input.merchantAmount,
    pinetreeFee: input.pinetreeFee,
    grossAmount: input.grossAmount,
    currency: input.currency,
    speedAccountId: invoiceAccount.speedAccountId,
    includeTransfers: invoiceAccount.includeTransfers,
    settlementAccountId: invoiceAccount.settlementAccountId,
    settlementAccountSource: invoiceAccount.settlementAccountSource,
    merchantLightningAddress,
    paymentAddressId
  })

  // Speed documents transfers[] with destination_account pointing to an existing
  // Speed account. PineTree never places arbitrary Lightning Addresses in this
  // field; the merchant Lightning Address is stored only as verified setup
  // metadata and as a merchant-facing receive reference.
  if (invoiceAccount.includeTransfers && !config.speedAccountTransfersSupported) {
    void body
    throw new Error(SPEED_SPLIT_SETTLEMENT_UNSUPPORTED_ERROR)
  }

  const headers: Record<string, string> = {
    "Authorization": buildSpeedAuthHeader(config.providerKey),
    "Content-Type": "application/json",
    "speed-version": "2022-10-15"
  }

  if (config.platformAccountId && envFlag("SPEED_USE_PLATFORM_ACCOUNT_HEADER")) {
    headers["speed-account"] = config.platformAccountId
  }

  if (isDevelopment()) {
    console.info("[lightning/speed] create payment request", sanitizeForLog(body))
  }

  const response = await fetch(`${normalizeApiBaseUrl(config.apiBaseUrl)}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  })

  const data = await readSpeedResponseBody(response)
  if (!response.ok) {
    console.error("[lightning/speed] create payment failed", {
      status: response.status,
      invoiceAccountIdMasked: invoiceAccount.settlementAccountId
        ? maskSpeedAccountId(invoiceAccount.settlementAccountId)
        : "",
      invoiceAccountSource: invoiceAccount.settlementAccountSource,
      includeTransfers: invoiceAccount.includeTransfers,
      body: sanitizeForLog(data)
    })

    const message = extractSpeedErrorMessage(data)
    throw new Error(`Speed Create Payment API error (${response.status}): ${message}`)
  }

  if (isDevelopment()) {
    console.info("[lightning/speed] create payment response", {
      status: response.status,
      body: sanitizeForLog(data)
    })
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
