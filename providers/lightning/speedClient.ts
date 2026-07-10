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
  platform_account_id?: string
  account_id?: string
  account_name?: string
  country?: string
  owner_email?: string
  first_name?: string
  last_name?: string
  email?: string
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

export type CreateSpeedCustomConnectedAccountParams = {
  country: string
  firstName: string
  lastName: string
  email: string
  password: string
  businessName?: string | null
  // Pre-computed by the caller (pineTreeWalletReadiness.ts is the single source
  // of truth for these policies) - carried through only so the request
  // diagnostic can report real values without duplicating validation logic here.
  emailValid?: boolean
  passwordPolicyValid?: boolean
}

export type CreateSpeedConnectedWebhookParams = {
  url: string
  description?: string
}

export type SpeedWebhookObject = {
  id?: string
  url?: string
  secret?: string
  enabled_events?: string[]
  api_version?: string
  connect?: boolean
  description?: string
  status?: string
  [key: string]: unknown
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

function safeSpeedErrorCode(status: number, body: string) {
  const normalized = String(body || "").toLowerCase()
  if (normalized.includes("email")) return "validation_email"
  if (normalized.includes("password")) return "validation_password"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status >= 500) return "provider_error"
  return "request_failed"
}

/**
 * Thrown for any non-2xx Speed API response. Carries the provider's own error
 * code and sanitized per-field validation messages (when Speed's body includes
 * them) so a 400 can be surfaced as the actual validation failure instead of
 * collapsing into a generic "request_failed" bucket. Extends Error, so every
 * existing `error instanceof Error` / `error.message` call site is unaffected.
 */
export class SpeedApiError extends Error {
  status: number
  providerCode: string | null
  fieldErrors: string[]

  constructor(message: string, status: number, providerCode: string | null, fieldErrors: string[]) {
    super(message)
    this.name = "SpeedApiError"
    this.status = status
    this.providerCode = providerCode
    this.fieldErrors = fieldErrors
  }
}

export type NormalizedSpeedProviderError = {
  providerStatus: number | null
  providerCode: string | null
  fieldErrors: string[]
}

function sanitizeSpeedFieldErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
    .replace(/sk_(test|live)_[A-Za-z0-9_-]+/g, "sk_$1_[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/password\s*[:=]\s*[^,\s}]+/gi, "password=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 200)
}

/**
 * Extracts Speed's provider error code and per-field validation messages from a
 * failed response body, tolerating whatever shape Speed actually returns
 * (`errors: [...]` as strings or `{ field, message }` objects, or a single
 * `error_message`/`message`). Never throws; unknown/unparseable bodies just
 * produce an empty result. Every returned string is sanitized and length-capped.
 */
export function parseSpeedErrorBody(body: string): { providerCode: string | null; fieldErrors: string[] } {
  let parsed: unknown = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== "object") {
    return { providerCode: null, fieldErrors: [] }
  }

  const fieldErrors: string[] = []
  let providerCode: string | null = null
  const seen = new Set<string>()

  function addError(value: unknown, field?: string | null) {
    if (fieldErrors.length >= 10) return
    const safe = sanitizeSpeedFieldErrorMessage(value)
    if (!safe) return
    const fieldName = sanitizeSpeedFieldErrorMessage(field || "")
    const line = fieldName ? `${fieldName}: ${safe}` : safe
    if (seen.has(line)) return
    seen.add(line)
    fieldErrors.push(line)
  }

  function visit(value: unknown, depth = 0) {
    if (depth > 5 || fieldErrors.length >= 10 || value == null) return
    if (typeof value === "string") {
      addError(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value !== "object") return

    const row = value as Record<string, unknown>
    if (!providerCode) {
      const providerCodeRaw = row.error_code ?? row.code ?? row.errorCode ?? row.type ?? null
      if (typeof providerCodeRaw === "string") {
        providerCode = sanitizeSpeedFieldErrorMessage(providerCodeRaw)?.slice(0, 60) || null
      }
    }

    const field = typeof row.field === "string"
      ? row.field
      : typeof row.param === "string"
        ? row.param
        : typeof row.name === "string"
          ? row.name
          : null
    addError(row.error_message ?? row.message ?? row.description ?? row.error, field)

    for (const key of [
      "errors",
      "field_errors",
      "validation_errors",
      "error_details",
      "list_errors",
      "data",
      "error",
    ]) {
      if (Object.prototype.hasOwnProperty.call(row, key)) visit(row[key], depth + 1)
    }
  }

  visit(parsed)
  return { providerCode, fieldErrors }
}

async function speedRequestWithStatus<T>(
  path: string,
  init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> }
): Promise<{ data: T; status: number }> {
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
    const { providerCode, fieldErrors } = parseSpeedErrorBody(body)
    console.error("[speed] API request failed", {
      path,
      status: response.status,
      safeCode: safeSpeedErrorCode(response.status, body)
    })
    if (path === "/connect/custom") {
      console.warn("[speed] speed_connect_custom_request_failed", {
        status: response.status,
        safeCode: safeSpeedErrorCode(response.status, body),
        providerCode,
        providerFieldErrorCount: fieldErrors.length,
      })
    }

    if (isSpeedTransferPercentageValidationMessage(body)) {
      throw new Error(SPEED_TRANSFER_SPLIT_ERROR)
    }

    throw new SpeedApiError(`Speed API returned ${response.status}`, response.status, providerCode, fieldErrors)
  }

  return { data: (await response.json()) as T, status: response.status }
}

async function speedRequest<T>(
  path: string,
  init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> }
): Promise<T> {
  const { data } = await speedRequestWithStatus<T>(path, init)
  return data
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
    ttl: params.ttlSeconds ?? 300,
    payment_methods: ["lightning"],
    statement_descriptor: "PineTree",
    description: `PineTree payment ${params.pineTreePaymentId}`,
    metadata,
    ...(useTreasurySweep
      ? {}
      : {
          account_id: merchantSpeedAccountId,
          application_fee: pineTreeFeeAmount
        }),
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

function speedConnectCustomDiagnostic(input: {
  requestStarted: boolean
  emailPresent: boolean
  emailValid: boolean
  passwordPresent: boolean
  passwordPolicyValid: boolean
  firstNamePresent: boolean
  lastNamePresent: boolean
  businessNamePresent: boolean
  countryPresent: boolean
  providerStatus: number | null
  providerCode: string | null
  providerFieldErrors: string[]
}) {
  return { endpoint: "/connect/custom", ...input }
}

export async function createSpeedCustomConnectedAccount(
  params: CreateSpeedCustomConnectedAccountParams
): Promise<SpeedConnectedAccountObject> {
  const country = String(params.country || "").trim().toUpperCase()
  const firstName = String(params.firstName || "").trim()
  const lastName = String(params.lastName || "").trim()
  const email = String(params.email || "").trim().toLowerCase()
  const password = String(params.password || "").trim()
  const businessName = String(params.businessName || "").trim()

  if (!country) throw new Error("Speed custom connected account country is required.")
  if (!firstName) throw new Error("Speed custom connected account first name is required.")
  if (!lastName) throw new Error("Speed custom connected account last name is required.")
  if (!email) throw new Error("Speed custom connected account email is required.")
  if (!password) throw new Error("Speed custom connected account password is required.")
  if (params.emailValid === false) throw new Error("Speed custom connected account email is invalid.")
  if (params.passwordPolicyValid === false) {
    throw new Error("Speed custom connected account password policy failed.")
  }

  const presenceFields = {
    emailPresent: Boolean(email),
    emailValid: params.emailValid ?? Boolean(email),
    passwordPresent: Boolean(password),
    passwordPolicyValid: params.passwordPolicyValid ?? Boolean(password),
    firstNamePresent: Boolean(firstName),
    lastNamePresent: Boolean(lastName),
    businessNamePresent: Boolean(businessName),
    countryPresent: Boolean(country),
  }

  // Diagnostics only - never the password or email value itself, only presence
  // and policy-pass booleans computed by the caller.
  console.info(
    "[speed] speed_connect_custom_request_diagnostic",
    speedConnectCustomDiagnostic({
      requestStarted: true,
      ...presenceFields,
      providerStatus: null,
      providerCode: null,
      providerFieldErrors: [],
    })
  )

  try {
    const { data, status } = await speedRequestWithStatus<SpeedConnectedAccountObject>("/connect/custom", {
      method: "POST",
      body: JSON.stringify({
        country,
        account_type: "merchant",
        first_name: firstName,
        last_name: lastName,
        email,
        password,
        ...(businessName ? { account_name: businessName } : {}),
      })
    })
    console.info(
      "[speed] speed_connect_custom_request_diagnostic",
      speedConnectCustomDiagnostic({
        requestStarted: true,
        ...presenceFields,
        providerStatus: status,
        providerCode: null,
        providerFieldErrors: [],
      })
    )
    return data
  } catch (error) {
    const isSpeedApiError = error instanceof SpeedApiError
    console.info(
      "[speed] speed_connect_custom_request_diagnostic",
      speedConnectCustomDiagnostic({
        requestStarted: true,
        ...presenceFields,
        providerStatus: isSpeedApiError ? error.status : null,
        providerCode: isSpeedApiError ? error.providerCode : null,
        providerFieldErrors: isSpeedApiError ? error.fieldErrors : [],
      })
    )
    throw error
  }
}

export async function createSpeedConnectedAccountWebhook(
  params: CreateSpeedConnectedWebhookParams
): Promise<SpeedWebhookObject> {
  const url = String(params.url || "").trim()
  if (!url) throw new Error("Speed connected-account webhook URL is required.")

  return speedRequest<SpeedWebhookObject>("/webhooks", {
    method: "POST",
    body: JSON.stringify({
      enabled_events: ["payment.created", "payment.paid"],
      api_version: SPEED_VERSION,
      url,
      description: params.description || "PineTree Speed connected-account payment webhook",
      connect: true
    })
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

function readSpeedWebhookField(payload: unknown, path: string[]): unknown {
  let cursor: unknown = payload
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

/**
 * Speed marks connected-account/sub-account events with an `account_id` on the
 * event payload (top-level or nested under data.object), mirroring how those
 * payments are created with `account_id` set. Account-level (platform) events
 * never carry this field.
 */
export function isSpeedConnectedAccountWebhookPayload(payload: unknown): boolean {
  const accountId =
    readSpeedWebhookField(payload, ["account_id"]) ||
    readSpeedWebhookField(payload, ["data", "object", "account_id"]) ||
    readSpeedWebhookField(payload, ["event", "data", "object", "account_id"])
  return Boolean(accountId && String(accountId).trim())
}

function resolveSpeedWebhookSecret(payload: unknown): string {
  const accountSecret = String(process.env.SPEED_WEBHOOK_SECRET || "").trim()
  if (!isSpeedConnectedAccountWebhookPayload(payload)) return accountSecret

  const connectSecret = String(process.env.SPEED_CONNECT_WEBHOOK_SECRET || "").trim()
  if (connectSecret) return connectSecret

  console.warn(
    "[speed] SPEED_CONNECT_WEBHOOK_SECRET is not configured; falling back to SPEED_WEBHOOK_SECRET to verify a connected-account webhook event"
  )
  return accountSecret
}

export function verifySpeedWebhookSignature(
  rawBody: string,
  headers: Record<string, string | undefined | null>,
  payload?: unknown
): boolean {
  const secret = resolveSpeedWebhookSecret(payload)
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
