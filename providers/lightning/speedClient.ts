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
const REQUEST_TIMEOUT_MS = 8_000
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

/**
 * Matches the official Speed Custom Connect API Documentation's documented
 * six-field /connect/custom request body exactly:
 * { country, account_type, first_name, last_name, email, password }.
 * `account_type` is always the literal "merchant" - it is not a parameter
 * here, never derived from PineTree's business_type. No other field
 * (phone, account_name, address, etc.) is part of this documented contract.
 */
export type CreateSpeedCustomConnectedAccountParams = {
  country: string
  firstName: string
  // Business name (DBA, or legal business name) or the owner's last name as a
  // final defensive fallback - Speed's documentation explicitly permits a
  // business name in last_name (its own example uses "CVS").
  lastName: string
  email: string
  password: string
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
  // OPTIONAL, internal bookkeeping ONLY - never sent to Speed in this unit.
  // A prior production incident sent this pre-converted sats value AS Speed's
  // application_fee and Speed's POST /payments rejected it with a 400 - the
  // official Speed Custom Connect API Documentation (confirmed 2026-07-23)
  // proves application_fee is a fixed amount in the payment's own `currency`
  // (USD), never sats, regardless of `target_currency`. The USD amount
  // (pineTreeFeeAmount) is what is sent as application_fee; this sats value
  // is only ever persisted in metadata for reconciliation/display.
  pineTreeFeeSats?: number
  // BTC/USD rate used to produce pineTreeFeeSats - persisted as the
  // conversion/quote reference, never used for anything except that record.
  btcPriceUsdAtFeeQuote?: number
  merchantSpeedAccountId?: string
  pineTreePaymentId: string
  pineTreePaymentIntentId?: string | null
  merchantId: string
  ttlSeconds?: number
  settlementMode?: SpeedLightningSettlementMode
  metadata?: Record<string, unknown>
}

/**
 * Confirmed 2026-07-23 against Speed's official Custom Connect API
 * Documentation (POST /payments: application_fee is a FIXED amount in the
 * payment's own fiat `currency`, e.g. USD - never converted to sats despite
 * `target_currency` being "SATS") plus Vivek's confirmation that
 * payments/instant-send scope the connected account via the `speed-account`
 * header (not a body field). "settled" is only ever set from real provider
 * evidence - a `transfers[]` entry with `created_type: "APPLICATION_FEE"` AND
 * a `transfer_id` - never inferred merely from the payment being paid.
 * "missing" and "failed" are deliberately merged into one state: Speed's
 * POST /payments is atomic (the whole request either succeeds or fails), so
 * there is no code path where the payment succeeds but the fee distinctly
 * "fails" separately from simply not appearing in `transfers[]`.
 * See docs/environment/bitcoin-fee-settlement.md.
 */
export type SpeedFeeSettlementStatus =
  | "not_applicable"          // no PineTree fee is owed on this payment
  | "retained_pending_sweep"  // treasury-sweep mode: fee retained internally, not via Speed's application_fee
  | "transfer_created"        // application_fee was requested and Speed's create-payment response confirmed a planned APPLICATION_FEE transfer
  | "missing"                 // a fee was expected but no APPLICATION_FEE transfer evidence was found
  | "settled"                 // a paid webhook/retrieval confirmed a realized APPLICATION_FEE transfer (has a transfer_id)

export type CreateSpeedLightningPaymentResult = {
  speedPaymentId: string
  paymentRequest: string
  paymentUrl: string
  hostedUrl?: string
  status: string
  merchantTransferPercentage: number
  transfers: SpeedPaymentTransfer[]
  metadata: Record<string, unknown>
  platformFeeSats: number | null
  feeSettlementStatus: SpeedFeeSettlementStatus
  applicationFeeRequested: number | null
  applicationFeeTransferDestinationAccount: string | null
  applicationFeeTransferFixedAmount: number | null
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

/** A single Speed validation issue. `field` is null when Speed's body didn't name one. */
export type SpeedFieldError = {
  field: string | null
  message: string
  validationCode?: string | null
  validationRule?: string | null
  duplicateEmail?: boolean
  malformedFormat?: boolean
  unsupportedDomain?: boolean
  emailLength?: boolean
  emailDeliverability?: boolean
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
  providerMessage: string | null
  fieldErrors: SpeedFieldError[]
  requestId: string | null
  retryable: boolean
  retryAfterMs: number | null
  responseContentType: string | null
  responseBodySummary: string | null
  responseBodyJsonParsed: boolean
  readonly outcomeUncertain = false

  constructor(
    message: string,
    status: number,
    providerCode: string | null,
    fieldErrors: SpeedFieldError[],
    providerMessage: string | null = null,
    requestId: string | null = null,
    retryAfterMs: number | null = null,
    responseDiagnostics: SpeedResponseDiagnostics | null = null
  ) {
    super(message)
    this.name = "SpeedApiError"
    this.status = status
    this.providerCode = providerCode
    this.fieldErrors = fieldErrors
    this.providerMessage = providerMessage ?? fieldErrors[0]?.message ?? null
    this.requestId = requestId
    this.retryable = [408, 429, 500, 502, 503, 504].includes(status)
    this.retryAfterMs = retryAfterMs
    this.responseContentType = responseDiagnostics?.contentType ?? null
    this.responseBodySummary = responseDiagnostics?.bodySummary ?? null
    this.responseBodyJsonParsed = responseDiagnostics?.jsonParsed ?? false
  }
}

export type SpeedMerchantRequestContext = {
  merchantId: string
  connectedAccountId: string
  operation: string
  pineTreePaymentId?: string | null
  pineTreePaymentIntentId?: string | null
}

export type SpeedRequestResult<T> = {
  data: T
  status: number
  requestId: string | null
  contentType: string | null
  responseBodySummary: string | null
  responseBodyJsonParsed: boolean
}

export type SpeedResponseDiagnostics = {
  contentType: string | null
  bodySummary: string | null
  jsonParsed: boolean
}

export class SpeedTransportError extends Error {
  readonly retryable = true
  readonly timedOut: boolean
  readonly outcomeUncertain: boolean
  readonly responseContentType: string | null
  readonly responseBodySummary: string | null
  readonly responseBodyJsonParsed: boolean

  constructor(
    message: string,
    timedOut: boolean,
    outcomeUncertain = timedOut,
    responseDiagnostics: SpeedResponseDiagnostics | null = null
  ) {
    super(message)
    this.name = "SpeedTransportError"
    this.timedOut = timedOut
    this.outcomeUncertain = outcomeUncertain
    this.responseContentType = responseDiagnostics?.contentType ?? null
    this.responseBodySummary = responseDiagnostics?.bodySummary ?? null
    this.responseBodyJsonParsed = responseDiagnostics?.jsonParsed ?? false
  }
}

export type NormalizedSpeedProviderError = {
  providerStatus: number | null
  providerCode: string | null
  fieldErrors: SpeedFieldError[]
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
    .replace(/(?:lightning:)?ln(?:bc|tb|bcrt)[a-z0-9]{20,}/gi, "[redacted-lightning-invoice]")
    .replace(/\b(?:bc1|tb1|bcrt1)[a-z0-9]{20,}\b/gi, "[redacted-bitcoin-address]")
    .slice(0, 200)
}

function classifySpeedEmailValidation(message: string): Pick<
  SpeedFieldError,
  "duplicateEmail" | "malformedFormat" | "unsupportedDomain" | "emailLength" | "emailDeliverability"
> {
  const normalized = message.toLowerCase()
  return {
    duplicateEmail:
      /\b(duplicate|already\s+(registered|exists|used|taken)|in\s+use|email\s+(exists|taken))\b/.test(normalized),
    malformedFormat:
      /\b(invalid|malformed|format|valid email|email address is invalid)\b/.test(normalized),
    unsupportedDomain:
      /\b(domain|disposable|temporary email|not accept|don't accept|do not accept|different email address|unsupported)\b/.test(normalized),
    emailLength:
      /\b(length|too long|too short|maximum|max|characters?)\b/.test(normalized),
    emailDeliverability:
      /\b(deliverable|deliverability|mailbox|mx|dns|bounce|receive|verify|verification)\b/.test(normalized),
  }
}

function sanitizeSpeedValidationCode(value: unknown): string | null {
  const safe = sanitizeSpeedFieldErrorMessage(value)
  if (!safe) return null
  const normalized = safe.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 80)
  return normalized || null
}

/**
 * Extracts Speed's provider error code and per-field validation messages from a
 * failed response body, tolerating whatever shape Speed actually returns
 * (`errors: [...]` as strings or `{ field, message }` objects, or a single
 * `error_message`/`message`). Never throws; unknown/unparseable bodies just
 * produce an empty result. Every returned string is sanitized and length-capped.
 */
export function parseSpeedErrorBody(body: string): {
  providerCode: string | null
  fieldErrors: SpeedFieldError[]
} {
  let parsed: unknown = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== "object") {
    return { providerCode: null, fieldErrors: [] }
  }

  const fieldErrors: SpeedFieldError[] = []
  let providerCode: string | null = null
  const seen = new Set<string>()

  function addError(value: unknown, field?: string | null, meta?: Record<string, unknown>) {
    if (fieldErrors.length >= 10) return
    const safe = sanitizeSpeedFieldErrorMessage(value)
    if (!safe) return
    const fieldName = sanitizeSpeedFieldErrorMessage(field || "")
    const key = `${fieldName || ""}|${safe}`
    if (seen.has(key)) return
    seen.add(key)
    const validationCode = sanitizeSpeedValidationCode(
      meta?.validation_code ?? meta?.validationCode ?? meta?.code ?? meta?.error_code ?? meta?.type ?? null
    )
    const validationRule = sanitizeSpeedValidationCode(
      meta?.rule ?? meta?.validation_rule ?? meta?.validationRule ?? meta?.reason ?? null
    )
    fieldErrors.push({
      field: fieldName || null,
      message: safe,
      validationCode,
      validationRule,
      ...(fieldName === "email" || /\bemail\b/i.test(safe) ? classifySpeedEmailValidation(safe) : {}),
    })
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
        : typeof row.parameter === "string"
          ? row.parameter
          : typeof row.name === "string"
            ? row.name
            : null
    addError(row.error_message ?? row.message ?? row.description ?? row.error, field, row)

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

const DIAGNOSTIC_SANITIZE_MAX_DEPTH = 6
const DIAGNOSTIC_SANITIZE_MAX_KEYS_PER_OBJECT = 30
const DIAGNOSTIC_SANITIZE_MAX_ARRAY_ITEMS = 20

function sanitizeSpeedErrorValueForDiagnostics(value: unknown, depth: number): unknown {
  if (depth > DIAGNOSTIC_SANITIZE_MAX_DEPTH) return "[truncated]"
  if (value == null) return value
  if (typeof value === "string") return sanitizeSpeedFieldErrorMessage(value) ?? ""
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value
      .slice(0, DIAGNOSTIC_SANITIZE_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeSpeedErrorValueForDiagnostics(item, depth + 1))
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>).slice(0, DIAGNOSTIC_SANITIZE_MAX_KEYS_PER_OBJECT)
    for (const [key, entryValue] of entries) {
      out[key] = sanitizeSpeedErrorValueForDiagnostics(entryValue, depth + 1)
    }
    return out
  }
  return String(value)
}

/**
 * Preserves Speed's ENTIRE error response structure (every key, not just a
 * flattened field/message pair) with every string leaf redacted the same way
 * as parseSpeedErrorBody. Unlike parseSpeedErrorBody - which intentionally
 * flattens to {field, message} for the common case - this is for temporary
 * diagnostic logging only, so a rejection carrying metadata the flattener
 * doesn't know about yet (e.g. allowed_values, parameter, expected,
 * country_id, details, documentation_url) is still fully visible in logs.
 * Never throws; unparseable bodies return null.
 */
export function sanitizeSpeedErrorStructureForDiagnostics(body: string): unknown {
  try {
    if (!body) return null
    const parsed = JSON.parse(body)
    return sanitizeSpeedErrorValueForDiagnostics(parsed, 0)
  } catch {
    return null
  }
}

/** Hostname only (never the full URL/path) - safe to include in logs. */
export function getSpeedApiHost(): string {
  try {
    return new URL(getSpeedApiBaseUrl()).hostname
  } catch {
    return "unknown"
  }
}

/**
 * The exact literal Speed's /connect/custom `country` field expects, per the
 * official Speed Custom Connect API Documentation (confirmed example body
 * uses `"country": "United States"`). Earlier attempts guessed the ISO-style
 * two-letter code `"US"` - Speed's own documentation proves that assumption
 * was wrong; production rejected `"US"` with `invalid_request_error` /
 * "Invalid Country. Your request can't be completed" twice.
 */
export const SPEED_COUNTRY_UNITED_STATES = "United States" as const

/**
 * Explicit allowlist of PineTree country spellings that map to Speed's
 * documented United States literal. Deliberately narrow and US-only for the
 * initial launch - PineTree's general Business Profile country list
 * (US/CA/MX/GB/AU, see engine/businessProfileLocation.ts) is broader than
 * what this endpoint is documented to support today. Only add another
 * country once it's confirmed against Speed's official documentation.
 */
const SPEED_COUNTRY_SYNONYMS: Record<string, string> = {
  US: SPEED_COUNTRY_UNITED_STATES,
  USA: SPEED_COUNTRY_UNITED_STATES,
  "UNITED STATES": SPEED_COUNTRY_UNITED_STATES,
  "UNITED STATES OF AMERICA": SPEED_COUNTRY_UNITED_STATES,
}

/**
 * Normalizes a PineTree country value to the exact literal Speed's
 * /connect/custom expects (`"United States"`). Returns null - never a guess -
 * for anything not on the explicit allowlist above, so the caller can stop
 * before issuing a request Speed is guaranteed to reject.
 */
export function normalizeSpeedCountry(value?: string | null): string | null {
  const trimmed = String(value || "").trim()
  if (!trimmed) return null
  const normalized = trimmed.toUpperCase().replace(/\s+/g, " ")
  return SPEED_COUNTRY_SYNONYMS[normalized] ?? null
}

function getConnectCustomRequestMetadata(body: unknown) {
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = typeof body === "string" ? JSON.parse(body) : null
  } catch {
    parsed = null
  }

  const email = String(parsed?.email || "")
  const [localPart = "", domain = ""] = email.split("@")
  const requiredFields = ["country", "account_type", "first_name", "last_name", "email", "password"]

  return {
    emailPresent: Boolean(email),
    emailTotalLength: email.length,
    emailLocalPartLength: localPart.length,
    emailDomainLength: domain.length,
    emailHasAtSign: email.includes("@"),
    emailHasWhitespace: /\s/.test(email),
    emailUsesManagedRootDomain: domain.toLowerCase() === "pinetree-payments.com",
    emailLocalPartAlphanumericHyphenOnly: /^[a-z0-9-]+$/.test(localPart),
    passwordConfigured: Boolean(String(parsed?.password || "")),
    requiredFieldsPresent: Boolean(parsed && requiredFields.every((field) => Boolean(String(parsed?.[field] || "")))),
  }
}

function speedRequestId(response: Response): string | null {
  return (
    response.headers?.get("speed-request-id") ||
    response.headers?.get("request-id") ||
    response.headers?.get("x-request-id") ||
    null
  )
}

function safeSpeedDiagnosticText(value: unknown, maxLength = 2_000) {
  return String(value || "")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/sk_(test|live)_[A-Za-z0-9._-]+/gi, "sk_$1_[redacted]")
    .slice(0, maxLength)
}

function responseHeadersForDiagnostics(headers: Headers) {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    result[normalizedKey] = normalizedKey === "set-cookie"
      ? "[redacted]"
      : safeSpeedDiagnosticText(value, 500)
  })
  return result
}

function speedWorkspaceIdForDiagnostics() {
  return String(process.env.SPEED_PLATFORM_ACCOUNT_ID || "").trim() || null
}

function speedRetryAfterMs(response: Response): number | null {
  const value = response.headers?.get("retry-after")
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, Math.round(seconds * 1_000))
  const dateMs = new Date(value).getTime()
  return Number.isFinite(dateMs) ? Math.min(10_000, Math.max(0, dateMs - Date.now())) : null
}

function parseSpeedSuccessBody<T>(body: string, diagnostics: SpeedResponseDiagnostics): T {
  if (!body.trim()) {
    diagnostics.jsonParsed = true
    return undefined as T
  }
  try {
    const parsed = JSON.parse(body) as T
    diagnostics.jsonParsed = true
    return parsed
  } catch {
    throw new SpeedTransportError("Speed API returned a malformed JSON response.", false, true, diagnostics)
  }
}

function speedBodyParsesAsJson(body: string): boolean {
  if (!body.trim()) return true
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}

export async function speedRequestWithStatus<T>(
  path: string,
  init?: Omit<RequestInit, "headers" | "signal"> & {
    headers?: Record<string, string>
    merchantContext?: SpeedMerchantRequestContext
  }
): Promise<SpeedRequestResult<T>> {
  const config = getPineTreeSpeedConfigStatus()
  const startedAt = Date.now()
  let response: Response
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const merchantId = init?.merchantContext?.merchantId || null
  const providerAccountId = String(init?.merchantContext?.connectedAccountId || "").trim()
  const operation = init?.merchantContext?.operation || `${init?.method || "GET"} ${path}`
  const pineTreePaymentId = init?.merchantContext?.pineTreePaymentId || null
  const pineTreePaymentIntentId = init?.merchantContext?.pineTreePaymentIntentId || null
  const requestUrl = `${config.apiBaseUrl}${path}`
  const method = init?.method || "GET"

  if (init?.merchantContext && !providerAccountId) {
    clearTimeout(timeout)
    throw new SpeedApiError("Speed connected account is not configured.", 400, "connected_account_missing", [], null)
  }
  if (init?.merchantContext && !providerAccountId.startsWith("acct_")) {
    clearTimeout(timeout)
    throw new SpeedApiError("Speed connected account is invalid.", 400, "connected_account_invalid", [], null)
  }
  const requestInit = { ...(init || {}) }
  delete requestInit.merchantContext
  let requestHeaders: Record<string, string> = {}

  try {
    if (path === "/connect/custom") {
      console.info("[speed] speed_connect_custom_prefetch_diagnostic", getConnectCustomRequestMetadata(init?.body))
    }
    requestHeaders = {
      ...(init?.headers || {}),
      ...getSpeedAuthHeaders(),
      ...(providerAccountId ? { "speed-account": providerAccountId } : {}),
    }
    response = await fetch(requestUrl, {
      ...requestInit,
      headers: requestHeaders,
      signal: controller.signal
    })
  } catch {
    const timedOut = controller.signal.aborted
    console.warn("[speed] request_transport_failure", {
      merchantId,
      providerAccountId: providerAccountId || null,
      operation,
      pineTreePaymentId,
      pineTreePaymentIntentId,
      timedOut,
      elapsedMs: Date.now() - startedAt,
      retryClassification: timedOut ? "uncertain_post_dispatch_timeout" : "retryable_transport_failure",
    })
    throw new SpeedTransportError(
      timedOut ? "Speed API request timed out." : "Speed API is temporarily unreachable.",
      timedOut
    )
  } finally {
    clearTimeout(timeout)
  }

  const requestId = speedRequestId(response)
  const retryAfterMs = speedRetryAfterMs(response)
  const contentType = response.headers?.get("content-type") || null
  const body = await response.text().catch(() => "")
  const responseDiagnostics: SpeedResponseDiagnostics = {
    contentType,
    bodySummary: safeSpeedDiagnosticText(body),
    jsonParsed: false,
  }
  if (operation === "balance.retrieve" || path === "/balances") {
    console.warn("[pinetree-withdrawals] SPEED_BALANCE_PROVIDER_RESPONSE_RAW", {
      requestUrl,
      method,
      responseStatus: response.status,
      responseBody: safeSpeedDiagnosticText(body),
      providerHeaders: responseHeadersForDiagnostics(response.headers),
      authorizationHeaderPresent: Boolean(new Headers(requestHeaders).get("authorization")),
      speedAccountHeaderPresent: Boolean(new Headers(requestHeaders).get("speed-account")),
      connectedAccountId: providerAccountId || null,
      workspaceId: speedWorkspaceIdForDiagnostics(),
      merchantId,
      environment: config.mode,
      apiHost: getSpeedApiHost(),
      requestId,
      ok: response.ok,
    })
  }

  if (!response.ok) {
    const { providerCode, fieldErrors } = parseSpeedErrorBody(body)
    responseDiagnostics.jsonParsed = speedBodyParsesAsJson(body)
    console.error("[speed] API request failed", {
      merchantId,
      providerAccountId: providerAccountId || null,
      operation,
      pineTreePaymentId,
      pineTreePaymentIntentId,
      status: response.status,
      requestId,
      safeCode: safeSpeedErrorCode(response.status, body),
      providerCode,
      providerMessage: fieldErrors[0]?.message || null,
      fieldErrorCount: fieldErrors.length,
      apiHost: getSpeedApiHost(),
      elapsedMs: Date.now() - startedAt,
      retryClassification: [408, 429, 500, 502, 503, 504].includes(response.status) ? "bounded_retry" : "permanent_no_retry",
    })

    // TEMPORARY diagnostic: parseSpeedErrorBody flattens each error to
    // {field, message} and silently drops any sibling metadata Speed's body
    // might carry (allowed_values, parameter, expected, country_id, details,
    // documentation_url, ...). Log the full structure - every key, not just
    // field/message - so a real rejection reveals whatever Speed actually
    // sent instead of only what today's flattener knows to look for. Remove
    // once Speed's /connect/custom country contract is confirmed.
    if (path === "/connect/custom") {
      console.warn("[speed] speed_custom_connect_error_detail", {
        status: response.status,
        sanitizedErrorBody: sanitizeSpeedErrorStructureForDiagnostics(body),
      })
    }

    if (isSpeedTransferPercentageValidationMessage(body)) {
      throw new Error(SPEED_TRANSFER_SPLIT_ERROR)
    }

    const safeMessage = response.status === 401
      ? "Speed authentication failed."
      : response.status === 403
        ? "Speed denied this operation."
        : `Speed API returned ${response.status}`
    throw new SpeedApiError(safeMessage, response.status, providerCode, fieldErrors, null, requestId, retryAfterMs, responseDiagnostics)
  }

  const data = parseSpeedSuccessBody<T>(body, responseDiagnostics)
  console.info("[speed] request_succeeded", {
    merchantId,
    providerAccountId: providerAccountId || null,
    operation,
    pineTreePaymentId,
    pineTreePaymentIntentId,
    status: response.status,
    requestId,
    elapsedMs: Date.now() - startedAt,
  })
  return {
    data,
    status: response.status,
    requestId,
    contentType,
    responseBodySummary: responseDiagnostics.bodySummary,
    responseBodyJsonParsed: responseDiagnostics.jsonParsed,
  }
}

export async function speedRequest<T>(
  path: string,
  init?: Omit<RequestInit, "headers" | "signal"> & {
    headers?: Record<string, string>
    merchantContext?: SpeedMerchantRequestContext
  }
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
  if (error instanceof SpeedTransportError || (error instanceof SpeedApiError && error.retryable)) {
    return "We couldn't prepare the Bitcoin Lightning payment. Check your connection and try again."
  }
  if (error instanceof SpeedApiError || message.startsWith("Speed API returned")) {
    return "We couldn't create this Bitcoin Lightning payment. Please choose another payment method or try again."
  }
  return null
}

export function shouldPreserveSpeedCreationIdempotencyClaim(error: unknown) {
  return error instanceof SpeedTransportError && error.outcomeUncertain
}

function paymentCreateRetryDelay(error: SpeedApiError | SpeedTransportError, attempt: number) {
  if (error instanceof SpeedApiError && error.retryAfterMs !== null) return error.retryAfterMs
  const exponential = Math.min(2_000, 250 * (2 ** attempt))
  return exponential + Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 4)))
}

async function createSpeedPaymentRequest(
  body: Record<string, unknown>,
  context: SpeedMerchantRequestContext
): Promise<SpeedPaymentObject> {
  const maxAttempts = 2
  const startedAt = Date.now()
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await speedRequest<SpeedPaymentObject>("/payments", {
        method: "POST",
        body: JSON.stringify(body),
        merchantContext: context,
      })
    } catch (error) {
      const retryable = error instanceof SpeedApiError
        ? error.retryable
        : error instanceof SpeedTransportError
          ? error.retryable && !error.outcomeUncertain
          : false
      const willRetry = retryable && attempt + 1 < maxAttempts
      console.warn("[speed] payment_create_attempt_failed", {
        operation: "payment.create",
        pineTreePaymentId: context.pineTreePaymentId || null,
        pineTreePaymentIntentId: context.pineTreePaymentIntentId || null,
        merchantId: context.merchantId,
        providerAccountId: context.connectedAccountId,
        httpStatus: error instanceof SpeedApiError ? error.status : null,
        requestId: error instanceof SpeedApiError ? error.requestId : null,
        providerCode: error instanceof SpeedApiError ? error.providerCode : null,
        providerMessage: error instanceof SpeedApiError ? error.providerMessage : null,
        elapsedMs: Date.now() - startedAt,
        retryClassification: willRetry
          ? "bounded_retry"
          : error instanceof SpeedTransportError && error.outcomeUncertain
            ? "uncertain_no_retry"
            : "permanent_no_retry",
        attempt: attempt + 1,
        maxAttempts,
      })
      if (!willRetry) throw error
      await new Promise((resolve) => setTimeout(resolve, paymentCreateRetryDelay(error as SpeedApiError | SpeedTransportError, attempt)))
    }
  }
  throw new Error("Speed payment creation failed")
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
  if (!useTreasurySweep && !merchantSpeedAccountId.startsWith("acct_")) {
    throw new Error("Merchant Speed account ID is invalid for Speed Lightning payments.")
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

  // application_fee is only applicable on the merchant-connected-account
  // (split) path: treasury-sweep mode routes the entire gross amount to
  // PineTree's own platform account directly (no connected account, no
  // split), so there is nothing for Speed's application_fee to carve out.
  const feeApplies = !useTreasurySweep && pineTreeFeeAmount > 0

  const platformFeeSats: number | null =
    feeApplies && Number.isInteger(Number(params.pineTreeFeeSats)) && Number(params.pineTreeFeeSats) > 0
      ? Number(params.pineTreeFeeSats)
      : null

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
    platform_fee_sats: platformFeeSats,
    fee_conversion_rate_usd: params.btcPriceUsdAtFeeQuote ?? null,
    merchant_net_usd: merchantAmount,
    ...(merchantSpeedAccountId ? { merchantSpeedAccountId, merchantTransferPercentage } : {})
  }

  // Per Speed's official Custom Connect API Documentation (confirmed
  // 2026-07-23): application_fee is a FIXED amount in the payment's own
  // `currency` (USD here) - never converted to sats, and never combined with
  // application_fee_percentage (PineTree's fee is fixed, not a percentage).
  const body = {
    currency: params.currency || "USD",
    amount: grossAmount,
    target_currency: "SATS",
    ttl: params.ttlSeconds ?? 300,
    payment_methods: ["lightning"],
    statement_descriptor: "PineTree",
    description: `PineTree payment ${params.pineTreePaymentId}`,
    metadata,
    ...(feeApplies ? { application_fee: pineTreeFeeAmount } : {}),
  }

  let payment: SpeedPaymentObject
  try {
    payment = useTreasurySweep
      ? await speedRequest<SpeedPaymentObject>("/payments", { method: "POST", body: JSON.stringify(body) })
      : await createSpeedPaymentRequest(body, {
          merchantId: params.merchantId,
          connectedAccountId: merchantSpeedAccountId,
          operation: "payment.create",
          pineTreePaymentId: params.pineTreePaymentId,
          pineTreePaymentIntentId: params.pineTreePaymentIntentId || null,
        })
  } catch (error) {
    // The generic "[speed] API request failed" log (speedRequestWithStatus)
    // already captures the provider-level diagnostics for any Speed call.
    // This adds the payment.create-specific context that log can't know
    // about - the exact request shape PineTree sent - so a 400 here is fully
    // diagnosable without guessing.
    const isSpeedError = error instanceof SpeedApiError
    console.error("[speed] bitcoin_payment_create_failed", {
      canonicalTransactionId: params.pineTreePaymentId,
      httpStatus: isSpeedError ? error.status : null,
      providerCode: isSpeedError ? error.providerCode : null,
      providerMessage: isSpeedError ? error.fieldErrors[0]?.message ?? null : null,
      fieldErrorCount: isSpeedError ? error.fieldErrors.length : 0,
      requestId: isSpeedError ? error.requestId : null,
      operation: "payment.create",
      settlementMode,
      applicationFeePresent: feeApplies,
      applicationFeeValue: feeApplies ? pineTreeFeeAmount : null,
      applicationFeePercentagePresent: false,
      speedAccountHeaderPresent: Boolean(merchantSpeedAccountId),
      apiEnvironment: inferSpeedMode(process.env.SPEED_API_KEY),
      invoiceCurrency: body.currency,
      targetCurrency: body.target_currency,
      merchantSpeedAccountSuffix: merchantSpeedAccountId ? merchantSpeedAccountId.slice(-6) : null,
    })
    throw error
  }

  const paymentRequest = getLightningPaymentRequest(payment)
  if (!payment.id || !paymentRequest) {
    throw new Error("Speed did not return a Lightning payment request.")
  }

  const hostedUrl = String(payment.hosted_url || payment.checkout_url || payment.url || "").trim()
  const transfers = Array.isArray(payment.transfers) ? payment.transfers : []
  const applicationFeeTransfer = feeApplies
    ? transfers.find((transfer) => String(transfer.created_type || "").toUpperCase() === "APPLICATION_FEE") ?? null
    : null

  // "settled" is never assigned here - only a later confirmed-payment
  // reconciliation (engine/speedFeeSettlement.ts) can prove a transfer_id was
  // realized. At creation time Speed's response only ever shows a *planned*
  // transfer (per the documented example, present even while status is
  // "unpaid"), never a transfer_id.
  const feeSettlementStatus: SpeedFeeSettlementStatus = !feeApplies
    ? (useTreasurySweep ? "retained_pending_sweep" : "not_applicable")
    : applicationFeeTransfer
      ? "transfer_created"
      : "missing"

  return {
    speedPaymentId: payment.id,
    paymentRequest,
    paymentUrl: `lightning:${paymentRequest}`,
    hostedUrl: hostedUrl || undefined,
    status: String(payment.status || "unpaid"),
    merchantTransferPercentage,
    transfers,
    metadata,
    platformFeeSats,
    feeSettlementStatus,
    applicationFeeRequested: feeApplies ? pineTreeFeeAmount : null,
    applicationFeeTransferDestinationAccount: applicationFeeTransfer?.destination_account
      ? String(applicationFeeTransfer.destination_account)
      : null,
    applicationFeeTransferFixedAmount: applicationFeeTransfer?.fixed_amount ?? null,
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

export async function retrieveSpeedPayment(
  paymentId: string,
  merchantContext?: SpeedMerchantRequestContext
): Promise<SpeedPaymentObject> {
  const id = String(paymentId || "").trim()
  if (!id) throw new Error("Missing Speed payment ID")
  return speedRequest<SpeedPaymentObject>(`/payments/${encodeURIComponent(id)}`, {
    method: "GET",
    ...(merchantContext ? { merchantContext } : {}),
  })
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

/** Speed's documented account_type literal for Custom Connect - never derived from PineTree's business_type. */
export const SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE = "merchant" as const

function speedConnectCustomDiagnostic(input: {
  requestStarted: boolean
  emailPresent: boolean
  emailValid: boolean
  passwordPresent: boolean
  passwordPolicyValid: boolean
  firstNamePresent: boolean
  lastNamePresent: boolean
  countryPresent: boolean
  providerStatus: number | null
  providerCode: string | null
  providerFieldErrorCount: number
}) {
  return { endpoint: "/connect/custom", ...input }
}

/**
 * Creates a Speed Custom Connect connected account. Sends exactly the six
 * fields documented in the official Speed Custom Connect API Documentation -
 * country, account_type, first_name, last_name, email, password - and
 * nothing else. No phone, account_name, address, or other optional field is
 * part of this documented contract, so none is ever included, even when
 * present/truthy on the caller's side.
 */
export async function createSpeedCustomConnectedAccount(
  params: CreateSpeedCustomConnectedAccountParams
): Promise<SpeedConnectedAccountObject> {
  // Defense in depth: the engine layer (pineTreeWalletReadiness.ts) is expected
  // to normalize and reject an unsupported country before ever calling this
  // function, but this client never trusts a caller's country string as-is -
  // it re-normalizes here too, so a bad value can never reach Speed regardless
  // of which caller invokes this.
  const country = normalizeSpeedCountry(params.country)
  const firstName = String(params.firstName || "").trim()
  const lastName = String(params.lastName || "").trim()
  const email = String(params.email || "").trim().toLowerCase()
  const password = String(params.password || "").trim()

  if (!country) throw new Error("Speed custom connected account country is not supported.")
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
    countryPresent: Boolean(country),
  }

  // Diagnostics only - never the password, email, first/last name value
  // itself, only presence and policy-pass booleans computed by the caller.
  console.info(
    "[speed] speed_connect_custom_request_diagnostic",
    speedConnectCustomDiagnostic({
      requestStarted: true,
      ...presenceFields,
      providerStatus: null,
      providerCode: null,
      providerFieldErrorCount: 0,
    })
  )

  try {
    const { data, status } = await speedRequestWithStatus<SpeedConnectedAccountObject>("/connect/custom", {
      method: "POST",
      body: JSON.stringify({
        country,
        account_type: SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE,
        first_name: firstName,
        last_name: lastName,
        email,
        password,
      })
    })
    console.info(
      "[speed] speed_connect_custom_request_diagnostic",
      speedConnectCustomDiagnostic({
        requestStarted: true,
        ...presenceFields,
        providerStatus: status,
        providerCode: null,
        providerFieldErrorCount: 0,
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
        providerFieldErrorCount: isSpeedApiError ? error.fieldErrors.length : 0,
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
 * event payload (top-level or nested under data.object). PineTree scopes the
 * corresponding API request with `speed-account`; platform events do not carry
 * a connected-account identifier.
 */
export function isSpeedConnectedAccountWebhookPayload(payload: unknown): boolean {
  return Boolean(extractSpeedWebhookAccountId(payload))
}

/**
 * Extracts the account_id a Speed webhook event carries, preferring the
 * top-level field (per the official webhook routing guidance: route
 * connected-account events using the top-level event account_id) and falling
 * back to the nested locations Speed has also been observed to use. Returns
 * null when no account_id is present (a platform-level event).
 */
export function extractSpeedWebhookAccountId(payload: unknown): string | null {
  const accountId =
    readSpeedWebhookField(payload, ["account_id"]) ||
    readSpeedWebhookField(payload, ["data", "object", "account_id"]) ||
    readSpeedWebhookField(payload, ["event", "data", "object", "account_id"])
  const trimmed = String(accountId || "").trim()
  return trimmed || null
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
