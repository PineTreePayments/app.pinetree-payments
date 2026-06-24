/**
 * PineTree Speed Lightning Client
 *
 * Default Speed Lightning uses PineTree's own Speed/TrySpeed platform account.
 * Merchant-owned Speed API keys are not part of the default provider flow.
 *
 * Authentication: HTTP Basic Auth, PineTree's SPEED_API_KEY as username, empty password.
 * Base URL: https://api.tryspeed.com (overridable via SPEED_API_BASE_URL env).
 *
 * Test endpoint used for validation: GET /payments?limit=1
 * This is a harmless read-only list. Returns 401 for invalid platform credentials.
 *
 * SECURITY: Never log or return SPEED_API_KEY.
 */

import { createHmac, timingSafeEqual } from "crypto"

const DEFAULT_SPEED_API_BASE_URL = "https://api.tryspeed.com"
const TEST_ENDPOINT = "/payments?limit=1"
const REQUEST_TIMEOUT_MS = 12_000
const SPEED_VERSION = "2022-10-15"

export type SpeedMode = "test" | "live" | "production" | "unknown"

export type PineTreeSpeedConfigStatus = {
  configured: boolean
  mode: SpeedMode
  apiBaseUrl: string
  dashboardUrl: string | null
  platformAccountIdConfigured: boolean
  webhookSecretConfigured: boolean
  missing: string[]
  warnings: string[]
  environmentKeyMismatch: boolean
  paymentProcessingLive: boolean
  settlementPathStatus: "ready" | "missing_platform_env" | "missing_merchant_speed_account" | "environment_key_mismatch"
  providerModel: "pine_tree_speed_platform"
}

export type SpeedConnectionResult = {
  connected: boolean
  mode: SpeedMode
  accountId: string | null
  displayName: string | null
  email: string | null
  notes: string[]
  config: PineTreeSpeedConfigStatus
}

export const SPEED_PLATFORM_TREASURY_SWEEP_MODE = "speed_platform_treasury_sweep" as const

// speed_merchant_account: PineTree creates/links a Speed sub-account per merchant
// internally and routes Lightning invoices through that account. Merchant never
// sees Speed. Status: stub — pending Speed API permission confirmation.
export const SPEED_MERCHANT_ACCOUNT_MODE = "speed_merchant_account" as const

export type SpeedLightningSettlementMode =
  | typeof SPEED_PLATFORM_TREASURY_SWEEP_MODE
  | typeof SPEED_MERCHANT_ACCOUNT_MODE
  | "speed_connect_split"
  | "legacy"
  | string

export type SpeedPaymentTransfer = {
  transfer_id?: string | null
  destination_account?: string | null
  percentage?: number | null
  fixed_amount?: number | null
  created_type?: string | null
  amount?: number | null
  description?: string | null
}

export type SpeedPaymentObject = {
  id: string
  object?: string
  status?: string
  currency?: string
  amount?: number
  target_currency?: string
  target_amount?: number
  target_amount_paid?: number | null
  payment_request?: string
  payment_method_options?: {
    lightning?: {
      payment_request?: string
      id?: string
    }
  }
  checkout_url?: string
  hosted_url?: string
  url?: string
  metadata?: Record<string, unknown>
  transfers?: SpeedPaymentTransfer[]
  expires_at?: number
  created?: number
  modified?: number
}

export type SpeedConnectedAccountObject = {
  id?: string
  object?: string
  type?: string
  status?: string
  account_id?: string
  account_name?: string
  country?: string
  owner_email?: string
  total_fee_collected?: number
  created?: number
  modified?: number
}

export type SpeedConnectedAccountList = {
  has_more?: boolean
  object?: string
  data?: SpeedConnectedAccountObject[]
}

export type SpeedConnectAccountLink = {
  link?: string
}

export type CreateSpeedLightningPaymentParams = {
  amount: number
  currency: string
  merchantAmount: number
  pineTreeFeeAmount: number
  merchantSpeedAccountId?: string
  pineTreePaymentId: string
  pineTreePaymentIntentId?: string | null
  merchantId: string
  ttlSeconds?: number
  settlementMode?: SpeedLightningSettlementMode
  metadata?: Record<string, unknown>
}

export type CreateSpeedLightningPaymentResult = {
  speedPaymentId: string
  paymentRequest: string
  paymentUrl: string
  hostedUrl?: string
  status: string
  merchantTransferPercentage: number
  transfers: SpeedPaymentTransfer[]
  metadata: Record<string, unknown>
  raw: SpeedPaymentObject
}

export type CreateSpeedWithdrawRequestParams = {
  merchantId?: string
  paymentId?: string
  amount: number
  currency?: string
  asset?: string
  destinationBtcAddress: string
  destinationAddressType?: string | null
  metadata?: Record<string, unknown>
  idempotencyKey?: string
}

export type SpeedWithdrawRequestObject = {
  id?: string
  object?: string
  status?: string
  payout_id?: string | null
  txid?: string | null
  transaction_hash?: string | null
  withdraw_method?: string | null
  withdraw_request?: string | null
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

const SPEED_TRANSFER_SPLIT_ERROR =
  "Lightning invoice could not be created because the transfer split was invalid. Please retry or choose another payment method."

function getSpeedApiBaseUrl(): string {
  return (process.env.SPEED_API_BASE_URL || DEFAULT_SPEED_API_BASE_URL).replace(/\/$/, "")
}

export function getLightningProviderConfig(): {
  provider: string
  settlementMode: SpeedLightningSettlementMode
  speedPlatformTreasurySweepEnabled: boolean
  speedMerchantAccountModeEnabled: boolean
} {
  const provider = String(process.env.PINE_TREE_LIGHTNING_PROVIDER || "").trim().toLowerCase()
  const settlementMode = String(process.env.PINE_TREE_LIGHTNING_SETTLEMENT_MODE || "").trim()

  return {
    provider,
    settlementMode,
    speedPlatformTreasurySweepEnabled:
      provider === "speed" && settlementMode === SPEED_PLATFORM_TREASURY_SWEEP_MODE,
    speedMerchantAccountModeEnabled:
      provider === "speed" && settlementMode === SPEED_MERCHANT_ACCOUNT_MODE,
  }
}

export function isSpeedPlatformTreasurySweepEnabled(): boolean {
  return getLightningProviderConfig().speedPlatformTreasurySweepEnabled
}

/**
 * Returns true when PINE_TREE_LIGHTNING_SETTLEMENT_MODE=speed_merchant_account.
 * In this mode PineTree provisions Speed sub-accounts per merchant internally.
 * Merchant never configures Speed. Status: stub pending Speed API confirmation.
 */
export function isSpeedMerchantAccountModeEnabled(): boolean {
  return getLightningProviderConfig().speedMerchantAccountModeEnabled
}

/**
 * Infer Speed mode from explicit env first, then from key prefix.
 */
export function inferSpeedMode(apiKey?: string | null): SpeedMode {
  const envMode = String(process.env.SPEED_ENVIRONMENT || "").trim().toLowerCase()
  if (envMode === "test" || envMode === "live" || envMode === "production") return envMode

  const key = String(apiKey || "").trim()
  if (key.startsWith("sk_test_")) return "test"
  if (key.startsWith("sk_live_")) return "live"
  return "unknown"
}

export function getPineTreeSpeedConfigStatus(): PineTreeSpeedConfigStatus {
  const apiKey = String(process.env.SPEED_API_KEY || "").trim()
  const envMode = String(process.env.SPEED_ENVIRONMENT || "").trim().toLowerCase()
  const apiBaseUrl = getSpeedApiBaseUrl()
  const dashboardUrl = String(process.env.SPEED_DASHBOARD_URL || "").trim() || null
  const missing: string[] = []
  const warnings: string[] = []

  if (!apiKey) missing.push("SPEED_API_KEY")
  if (!String(process.env.SPEED_WEBHOOK_SECRET || "").trim()) missing.push("SPEED_WEBHOOK_SECRET")

  const explicitProduction = envMode === "production" || envMode === "live"
  const explicitTest = envMode === "test"
  const environmentKeyMismatch = Boolean(
    (explicitProduction && apiKey.startsWith("sk_test_")) ||
    (explicitTest && apiKey.startsWith("sk_live_"))
  )

  if (environmentKeyMismatch) {
    warnings.push(
      explicitProduction
        ? "SPEED_ENVIRONMENT is production/live but SPEED_API_KEY looks like a test key."
        : "SPEED_ENVIRONMENT is test but SPEED_API_KEY looks like a live key."
    )
  }

  return {
    configured: missing.length === 0 && !environmentKeyMismatch,
    mode: inferSpeedMode(apiKey),
    apiBaseUrl,
    dashboardUrl,
    platformAccountIdConfigured: Boolean(
      String(process.env.SPEED_PLATFORM_ACCOUNT_ID || "").trim()
    ),
    webhookSecretConfigured: Boolean(String(process.env.SPEED_WEBHOOK_SECRET || "").trim()),
    missing,
    warnings,
    environmentKeyMismatch,
    paymentProcessingLive: missing.length === 0 && !environmentKeyMismatch,
    settlementPathStatus: environmentKeyMismatch
      ? "environment_key_mismatch"
      : missing.length === 0
        ? "ready"
        : "missing_platform_env",
    providerModel: "pine_tree_speed_platform"
  }
}

function getSpeedApiKey(): string {
  const apiKey = String(process.env.SPEED_API_KEY || "").trim()
  if (!apiKey) {
    throw new Error("PineTree Speed platform is missing SPEED_API_KEY")
  }
  return apiKey
}

function getSpeedAuthHeaders(): Record<string, string> {
  const authToken = Buffer.from(`${getSpeedApiKey()}:`).toString("base64")
  return {
    Authorization: `Basic ${authToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "speed-version": SPEED_VERSION
  }
}

async function speedRequest<T>(
  path: string,
  init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> }
): Promise<T> {
  const config = getPineTreeSpeedConfigStatus()
  let response: Response

  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...getSpeedAuthHeaders(),
        ...(init?.headers || {})
      },
      signal: init?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      message.includes("timed out") || message.includes("timeout")
        ? "Speed API request timed out. Check PineTree's Speed platform connectivity."
        : `Speed API unreachable: ${message}`
    )
  }

  if (response.status === 401) {
    throw new Error("PineTree Speed platform API key is invalid.")
  }

  if (response.status === 403) {
    throw new Error("PineTree Speed platform API key lacks permission for this Speed operation.")
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    console.error("[speed] API request failed", {
      path,
      status: response.status,
      body: body.slice(0, 1000)
    })

    if (isSpeedTransferPercentageValidationMessage(body)) {
      throw new Error(SPEED_TRANSFER_SPLIT_ERROR)
    }

    throw new Error(`Speed API returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`)
  }

  return response.json() as Promise<T>
}

/**
 * Test PineTree's server-side Speed platform credentials.
 *
 * Returns sanitized connection status only. Does not expose or log SPEED_API_KEY.
 */
export async function testPineTreeSpeedConnection(): Promise<SpeedConnectionResult> {
  const config = getPineTreeSpeedConfigStatus()
  await speedRequest<unknown>(TEST_ENDPOINT, { method: "GET" })

  const notes: string[] = [
    "PineTree platform credential test passed.",
    "Speed Lightning payments require a merchant Speed account ID before checkout is enabled."
  ]

  if (config.mode === "unknown") {
    notes.push("Could not detect test or live mode from SPEED_ENVIRONMENT or SPEED_API_KEY prefix.")
  }
  notes.push(...config.warnings)

  return {
    connected: true,
    mode: config.mode,
    accountId: null,
    displayName: null,
    email: null,
    notes,
    config
  }
}

function isSpeedTransferPercentageValidationMessage(message: string): boolean {
  const normalized = String(message || "").toLowerCase()
  return (
    normalized.includes("transfers[0].percentage") ||
    (normalized.includes("invalid percentage") && normalized.includes("percentage"))
  )
}

export function getSafeSpeedCustomerErrorMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error || "")
  if (message === SPEED_TRANSFER_SPLIT_ERROR || isSpeedTransferPercentageValidationMessage(message)) {
    return SPEED_TRANSFER_SPLIT_ERROR
  }
  if (message.startsWith("Speed API returned")) {
    return "Lightning invoice could not be created. Please retry or choose another payment method."
  }
  return null
}

export function formatSpeedPercentage(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid Speed percentage")
  if (value < 0) throw new Error("Invalid Speed percentage")
  if (value > 100) throw new Error("Invalid Speed percentage")
  return Number(value.toFixed(2))
}

export function calculateSpeedMerchantTransferPercentage(
  grossAmount: number,
  pineTreeFeeAmount: number
): number {
  const gross = Number(grossAmount)
  const pineTreeFee = Number(pineTreeFeeAmount)
  if (!Number.isFinite(gross) || gross <= 0) {
    throw new Error("Speed payment amount must be greater than zero")
  }
  if (!Number.isFinite(pineTreeFee) || pineTreeFee < 0) {
    throw new Error("Invalid PineTree service fee")
  }
  if (gross <= pineTreeFee) {
    throw new Error("Lightning amount must be greater than the PineTree service fee.")
  }

  const merchantPercentage = ((gross - pineTreeFee) / gross) * 100
  const formattedPercentage = formatSpeedPercentage(merchantPercentage)
  if (formattedPercentage <= 0) {
    throw new Error("Lightning amount must be greater than the PineTree service fee.")
  }
  return formattedPercentage
}

function getLightningPaymentRequest(payment: SpeedPaymentObject): string {
  return String(
    payment.payment_request ||
      payment.payment_method_options?.lightning?.payment_request ||
      ""
  ).trim()
}

export async function createSpeedLightningPayment(
  params: CreateSpeedLightningPaymentParams
): Promise<CreateSpeedLightningPaymentResult> {
  const settlementMode = params.settlementMode || "speed_connect_split"
  const useTreasurySweep = settlementMode === SPEED_PLATFORM_TREASURY_SWEEP_MODE
  const merchantSpeedAccountId = String(params.merchantSpeedAccountId || "").trim()
  if (!useTreasurySweep && !merchantSpeedAccountId) {
    throw new Error("Merchant Speed account ID is required for Speed Lightning payments.")
  }

  const grossAmount = Number(params.amount)
  const merchantAmount = Number(params.merchantAmount)
  const pineTreeFeeAmount = Number(params.pineTreeFeeAmount)
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    throw new Error("Speed payment amount must be greater than zero")
  }
  if (!Number.isFinite(pineTreeFeeAmount) || pineTreeFeeAmount < 0) {
    throw new Error("Invalid PineTree service fee")
  }
  if (grossAmount <= pineTreeFeeAmount) {
    throw new Error("Lightning amount must be greater than the PineTree service fee.")
  }

  const merchantTransferPercentageRaw = ((grossAmount - pineTreeFeeAmount) / grossAmount) * 100
  const merchantTransferPercentage = calculateSpeedMerchantTransferPercentage(
    grossAmount,
    pineTreeFeeAmount
  )
  if (process.env.NODE_ENV === "development") {
    console.info("[speed] Lightning split prepared", {
      grossAmount,
      pineTreeFeeAmount,
      merchantTransferPercentageRaw,
      merchantTransferPercentage,
      transferCount: 1,
      destinationAccountPresent: Boolean(merchantSpeedAccountId)
    })
  }

  const paymentIntentId = String(params.pineTreePaymentIntentId || "").trim()
  const metadata: Record<string, unknown> = {
    ...(params.metadata || {}),
    pineTreePaymentId: params.pineTreePaymentId,
    pineTreePaymentIntentId: paymentIntentId || undefined,
    merchantId: params.merchantId,
    merchantAmount,
    pineTreeFeeAmount,
    grossAmount,
    provider: "lightning_speed",
    settlement_mode: settlementMode,
    settlementMode,
    platform_fee_usd: pineTreeFeeAmount,
    merchant_net_usd: merchantAmount,
    ...(merchantSpeedAccountId ? { merchantSpeedAccountId, merchantTransferPercentage } : {})
  }

  const body = {
    currency: params.currency || "USD",
    amount: grossAmount,
    target_currency: "SATS",
    payment_methods: ["lightning"],
    metadata,
    ...(useTreasurySweep
      ? {}
      : {
          transfers: [
            {
              destination_account: merchantSpeedAccountId,
              percentage: merchantTransferPercentage,
              description: `Merchant settlement for PineTree payment ${params.pineTreePaymentId}`
            }
          ]
        }),
    ...(params.ttlSeconds ? { ttl: params.ttlSeconds } : {})
  }

  const payment = await speedRequest<SpeedPaymentObject>("/payments", {
    method: "POST",
    body: JSON.stringify(body)
  })

  const paymentRequest = getLightningPaymentRequest(payment)
  if (!payment.id || !paymentRequest) {
    throw new Error("Speed did not return a Lightning payment request.")
  }

  const hostedUrl = String(payment.hosted_url || payment.checkout_url || payment.url || "").trim()

  return {
    speedPaymentId: payment.id,
    paymentRequest,
    paymentUrl: `lightning:${paymentRequest}`,
    hostedUrl: hostedUrl || undefined,
    status: String(payment.status || "unpaid"),
    merchantTransferPercentage,
    transfers: Array.isArray(payment.transfers) ? payment.transfers : [],
    metadata,
    raw: payment
  }
}

export async function createSpeedWithdrawRequest(
  params: CreateSpeedWithdrawRequestParams
): Promise<SpeedWithdrawRequestObject> {
  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Speed withdraw amount must be greater than zero")
  }

  const destination = String(params.destinationBtcAddress || "").trim()
  if (!destination) {
    throw new Error("Destination BTC address is required for Speed withdraw request")
  }

  const metadata: Record<string, unknown> = {
    ...(params.metadata || {}),
    ...(params.merchantId ? { merchant_id: params.merchantId } : {}),
    ...(params.paymentId ? { payment_id: params.paymentId } : {}),
    ...(params.destinationAddressType ? { destination_address_type: params.destinationAddressType } : {})
  }

  const body = {
    amount,
    currency: params.currency || params.asset || "SATS",
    target_currency: params.asset || params.currency || "SATS",
    withdraw_method: "onchain",
    withdraw_request: destination,
    note: JSON.stringify({
      source: "pinetree_lightning_payout",
      merchant_id: params.merchantId || metadata.merchant_id,
      payment_id: params.paymentId || metadata.payment_id,
      settlement_mode: metadata.settlement_mode
    })
  }

  const headers = params.idempotencyKey
    ? { "Idempotency-Key": params.idempotencyKey }
    : undefined

  return speedRequest<SpeedWithdrawRequestObject>("/send", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  })
}

export async function retrieveSpeedPayment(paymentId: string): Promise<SpeedPaymentObject> {
  const id = String(paymentId || "").trim()
  if (!id) throw new Error("Missing Speed payment ID")
  return speedRequest<SpeedPaymentObject>(`/payments/${encodeURIComponent(id)}`, { method: "GET" })
}

export async function createSpeedConnectAccountLink(params: {
  returnUrl?: string | null
} = {}): Promise<SpeedConnectAccountLink> {
  const body: Record<string, unknown> = { account_type: "Standard" }
  const returnUrl = String(params.returnUrl || "").trim()
  if (returnUrl) body.return_url = returnUrl

  return speedRequest<SpeedConnectAccountLink>("/connect/generate/account-link", {
    method: "POST",
    body: JSON.stringify(body)
  })
}

export async function retrieveSpeedConnectedAccount(
  connectedAccountId: string
): Promise<SpeedConnectedAccountObject> {
  const id = String(connectedAccountId || "").trim()
  if (!id) throw new Error("Missing Speed connected account ID")
  return speedRequest<SpeedConnectedAccountObject>(`/connect/${encodeURIComponent(id)}`, {
    method: "GET"
  })
}

export async function listSpeedConnectedAccounts(): Promise<SpeedConnectedAccountList> {
  return speedRequest<SpeedConnectedAccountList>("/connect", { method: "GET" })
}

export function verifySpeedWebhookSignature(
  rawBody: string,
  headers: Record<string, string | undefined | null>
): boolean {
  const secret = String(process.env.SPEED_WEBHOOK_SECRET || "").trim()
  if (!secret || !secret.startsWith("wsec_")) return false

  const signatureHeader = String(headers["webhook-signature"] || "").trim()
  const timestamp = String(headers["webhook-timestamp"] || "").trim()
  const webhookId = String(headers["webhook-id"] || "").trim()
  if (!signatureHeader || !timestamp || !webhookId || !rawBody) return false

  const signature = signatureHeader
    .split(" ")
    .find((part) => part.startsWith("v1,"))
    ?.slice("v1,".length) || signatureHeader.replace(/^v1,/, "")
  if (!signature) return false

  let secretBytes: Buffer
  try {
    secretBytes = Buffer.from(secret.slice("wsec_".length), "base64")
  } catch {
    return false
  }

  const signedPayload = `${webhookId}.${timestamp}.${rawBody}`
  const expected = createHmac("sha256", secretBytes)
    .update(signedPayload, "utf8")
    .digest("base64")

  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function isSpeedPaymentPaid(payment: Pick<SpeedPaymentObject, "status">): boolean {
  const status = String(payment.status || "").toLowerCase().trim()
  return status === "paid" || status === "confirmed"
}
