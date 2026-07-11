/**
 * Server-side Speed Connect provisioning helper.
 *
 * PineTree Wallet uses PineTree's Speed platform account for Lightning.
 * Merchants never provide Speed API keys, NWC strings, or Speed dashboard setup
 * details through the wallet setup UI.
 */

import {
  createSpeedConnectAccountLink,
  createSpeedCustomConnectedAccount,
  getPineTreeSpeedConfigStatus,
  getSpeedApiHost,
  listSpeedConnectedAccounts,
  retrieveSpeedConnectedAccount,
  SpeedApiError,
  type SpeedConnectedAccountObject,
  type SpeedFieldError,
  type SpeedMode,
} from "./speedClient"

export type SpeedConnectedAccountReadiness = "pending" | "ready" | "needs_attention"

export type CreateOrLinkSpeedConnectedAccountInput = {
  merchant_id: string
  business_name?: string | null
  merchant_email?: string | null
  pinetree_reference_id: string
}

export type CreateSpeedCustomConnectedAccountForMerchantInput = {
  merchant_id: string
  country: string
  first_name: string
  last_name: string
  email: string
  password: string
  business_name?: string | null
  // E.164-normalized phone, pre-validated by the caller. Never manufactured
  // here - omitted from the Speed request entirely when not provided.
  phone?: string | null
  // Speed's account_type enum value, pre-mapped by the caller from PineTree's
  // business_type UI label via an explicit mapping table.
  account_type?: string | null
  // Pre-computed policy checks from the caller (single source of truth in
  // pineTreeWalletReadiness.ts) - forwarded only for request diagnostics.
  email_valid?: boolean
  password_policy_valid?: boolean
}

export type SpeedConnectedAccountSummary = {
  connected_account_id: string | null
  platform_account_id?: string | null
  account_id: string | null
  account_name: string | null
  owner_email_present: boolean
  status: string | null
  type: string | null
  setup_url_present?: boolean
  source: "existing_connected_account" | "invite_account_link" | "not_configured" | "error"
}

export type CreateOrLinkSpeedConnectedAccountResult = {
  status: SpeedConnectedAccountReadiness
  speed_connected_account_id: string | null
  speed_connected_account_relationship_id: string | null
  speed_account_id: string | null
  speed_connected_account_status: string | null
  setup_url: string | null
  provider_response_summary: SpeedConnectedAccountSummary
  error_message: string | null
  raw_provider_status: string
  readiness: SpeedConnectedAccountReadiness
  mode: SpeedMode
  used_live_api: boolean
  // Speed's own error code and sanitized per-field validation messages from a
  // rejected /connect/custom request (e.g. HTTP 400) - null/empty on success or
  // when Speed's response body didn't include field-level detail.
  provider_code: string | null
  provider_message: string | null
  field_errors: SpeedFieldError[]
  // HTTP status of the rejected Speed response, when one exists. Used by the
  // caller to distinguish a deterministic validation rejection (4xx - must not
  // be retried with an unchanged profile) from a transient/provider failure
  // (5xx, timeout, network) - both otherwise collapse into "needs_attention".
  provider_http_status: number | null
}

const READY_SPEED_ACCOUNT_STATUSES = new Set([
  "active",
  "approved",
  "connected",
  "enabled",
  "ready",
  "ready_for_payments",
  "verified",
])

const NEEDS_ATTENTION_SPEED_ACCOUNT_STATUSES = new Set([
  "action_required",
  "disabled",
  "failed",
  "incomplete",
  "rejected",
  "restricted",
  "suspended",
])

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function isSpeedConnectEnabled() {
  return normalized(process.env.SPEED_CONNECT_ENABLED) === "true"
}

function getSpeedConnectReturnUrl(merchantId: string) {
  const configured = String(process.env.SPEED_CONNECT_RETURN_URL || "").trim()
  if (!configured) return null

  try {
    const url = new URL(configured)
    url.searchParams.set("merchant_id", merchantId)
    return url.toString()
  } catch {
    return null
  }
}

function summarizeConnectedAccount(
  account: SpeedConnectedAccountObject | null,
  source: SpeedConnectedAccountSummary["source"]
): SpeedConnectedAccountSummary {
  return {
    connected_account_id: account?.id ? String(account.id) : null,
    platform_account_id: account?.platform_account_id ? String(account.platform_account_id) : null,
    account_id: account?.account_id ? String(account.account_id) : null,
    account_name: account?.account_name ? String(account.account_name) : null,
    owner_email_present: Boolean(account?.owner_email),
    status: account?.status ? String(account.status) : null,
    type: account?.type ? String(account.type) : null,
    source,
  }
}

function emptySummary(source: SpeedConnectedAccountSummary["source"]): SpeedConnectedAccountSummary {
  return summarizeConnectedAccount(null, source)
}

function inviteLinkSummary(setupUrl: string): SpeedConnectedAccountSummary {
  return {
    ...emptySummary("invite_account_link"),
    setup_url_present: Boolean(setupUrl),
  }
}

function safeProviderErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || "")
  const safe = (message || fallback)
    .replace(/sk_(test|live)_[A-Za-z0-9_-]+/g, "sk_$1_[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .slice(0, 500)
  return safe || fallback
}

export function normalizeSpeedConnectedAccountReadiness(input: {
  speedConnectedAccountId?: string | null
  rawProviderStatus?: string | null
}): SpeedConnectedAccountReadiness {
  const status = normalized(input.rawProviderStatus)
  if (NEEDS_ATTENTION_SPEED_ACCOUNT_STATUSES.has(status)) return "needs_attention"
  if (input.speedConnectedAccountId && READY_SPEED_ACCOUNT_STATUSES.has(status)) return "ready"
  return "pending"
}

function result(input: {
  status: SpeedConnectedAccountReadiness
  speedConnectedAccountId?: string | null
  speedConnectedAccountStatus?: string | null
  setupUrl?: string | null
  summary: SpeedConnectedAccountSummary
  errorMessage?: string | null
  mode: SpeedMode
  usedLiveApi: boolean
  providerCode?: string | null
  providerMessage?: string | null
  fieldErrors?: SpeedFieldError[]
  providerHttpStatus?: number | null
}): CreateOrLinkSpeedConnectedAccountResult {
  const providerStatus = input.speedConnectedAccountStatus || input.summary.status || input.status
  return {
    status: input.status,
    speed_connected_account_id: input.speedConnectedAccountId || null,
    speed_connected_account_relationship_id: input.summary.connected_account_id || null,
    speed_account_id: input.summary.account_id || null,
    speed_connected_account_status: input.speedConnectedAccountStatus || null,
    setup_url: input.setupUrl || null,
    provider_code: input.providerCode || null,
    provider_message: input.providerMessage || null,
    field_errors: input.fieldErrors || [],
    provider_http_status: input.providerHttpStatus ?? null,
    provider_response_summary: input.summary,
    error_message: input.errorMessage || null,
    raw_provider_status: providerStatus,
    readiness: input.status,
    mode: input.mode,
    used_live_api: input.usedLiveApi,
  }
}

export async function createSpeedCustomConnectedAccountForMerchant(
  input: CreateSpeedCustomConnectedAccountForMerchantInput
): Promise<CreateOrLinkSpeedConnectedAccountResult> {
  const config = getPineTreeSpeedConfigStatus()

  if (!isSpeedConnectEnabled()) {
    return result({
      status: "pending",
      speedConnectedAccountStatus: "speed_connect_disabled",
      summary: emptySummary("not_configured"),
      errorMessage: "Speed Connect is disabled until SPEED_CONNECT_ENABLED=true is configured.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  if (!String(process.env.SPEED_API_KEY || "").trim()) {
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_api_key_missing",
      summary: emptySummary("not_configured"),
      errorMessage: "PineTree Speed platform is missing SPEED_API_KEY.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  if (config.environmentKeyMismatch) {
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_platform_configuration_invalid",
      summary: emptySummary("not_configured"),
      errorMessage: "Speed platform configuration has an environment/key mismatch.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  const startedAt = Date.now()
  console.info("[speed-custom-connect] provisioning_step", {
    merchant_id: input.merchant_id,
    step: "existing_account_lookup_start",
  })
  try {
    const existing = await findExistingConnectedAccountByEmail(input.email)
    if (existing) {
      const summary = summarizeConnectedAccount(existing, "existing_connected_account")
      const accountReference = summary.account_id || summary.connected_account_id
      const readiness = normalizeSpeedConnectedAccountReadiness({
        speedConnectedAccountId: accountReference,
        rawProviderStatus: summary.status,
      })
      console.info("[speed-custom-connect] provisioning_timing", {
        merchant_id: input.merchant_id,
        step: "existing_account_reused",
        duration_ms: Date.now() - startedAt,
      })
      return result({
        status: readiness,
        speedConnectedAccountId: accountReference,
        speedConnectedAccountStatus: summary.status,
        summary,
        mode: config.mode,
        usedLiveApi: true,
      })
    }
  } catch (error) {
    console.warn("[speed-custom-connect] existing_account_lookup_failed", {
      merchant_id: input.merchant_id,
      error: safeProviderErrorMessage(error, "Existing account lookup failed."),
    })
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "existing_account_lookup_failed",
      summary: emptySummary("error"),
      errorMessage: "Existing Speed account lookup failed. Retry before creating another account.",
      mode: config.mode,
      usedLiveApi: true,
    })
  }

  console.info("[speed-custom-connect] provisioning_step", {
    merchant_id: input.merchant_id,
    step: "custom_account_create_start",
  })
  try {
    const account = await createSpeedCustomConnectedAccount({
      country: input.country,
      firstName: input.first_name,
      lastName: input.last_name,
      email: input.email,
      password: input.password,
      businessName: input.business_name,
      phone: input.phone,
      accountType: input.account_type,
      emailValid: input.email_valid,
      passwordPolicyValid: input.password_policy_valid,
    })
    const summary = summarizeConnectedAccount(account, "existing_connected_account")
    const accountReference = summary.account_id || summary.connected_account_id
    const readiness = normalizeSpeedConnectedAccountReadiness({
      speedConnectedAccountId: accountReference,
      rawProviderStatus: summary.status,
    })

    const created = result({
      status: readiness,
      speedConnectedAccountId: accountReference,
      speedConnectedAccountStatus: summary.status || "unknown",
      summary,
      mode: config.mode,
      usedLiveApi: true,
    })
    console.info("[speed-custom-connect] provisioning_timing", {
      merchant_id: input.merchant_id,
      step: "custom_account_create_complete",
      duration_ms: Date.now() - startedAt,
    })
    return created
  } catch (error) {
    console.info("[speed-custom-connect] provisioning_timing", {
      merchant_id: input.merchant_id,
      step: "custom_account_create_failed",
      duration_ms: Date.now() - startedAt,
    })
    // Capture Speed's own validation reason (e.g. a 400 field error) instead of
    // collapsing every failure into the same generic "failed" bucket.
    const isSpeedApiError = error instanceof SpeedApiError
    if (isSpeedApiError) {
      // Structured event: everything an operator needs to diagnose a rejected
      // /connect/custom request without ever seeing a secret, password, email,
      // phone, name, or address value - see the safe-field allowlist below.
      console.warn("[speed-custom-connect] speed_custom_connect_rejected", {
        merchant_id: input.merchant_id,
        status: error.status,
        provider_code: error.providerCode,
        provider_message: error.providerMessage,
        field_errors: error.fieldErrors,
        request_presence: {
          email: Boolean(input.email),
          password: Boolean(input.password),
          business_name: Boolean(input.business_name),
          first_name: Boolean(input.first_name),
          last_name: Boolean(input.last_name),
          phone: Boolean(input.phone),
        },
        api_host: getSpeedApiHost(),
        elapsed_ms: Date.now() - startedAt,
      })
    }
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_custom_connect_failed",
      summary: emptySummary("error"),
      errorMessage: safeProviderErrorMessage(error, "Speed custom connected account creation failed."),
      mode: config.mode,
      usedLiveApi: true,
      providerCode: isSpeedApiError ? error.providerCode : null,
      providerMessage: isSpeedApiError ? error.providerMessage : null,
      fieldErrors: isSpeedApiError ? error.fieldErrors : [],
      providerHttpStatus: isSpeedApiError ? error.status : null,
    })
  }
}

async function findExistingConnectedAccountByEmail(email: string) {
  const list = await listSpeedConnectedAccounts()
  const accounts = Array.isArray(list.data) ? list.data : []
  const target = normalized(email)
  return (
    accounts.find((account) => normalized(account.owner_email) === target) ||
    null
  )
}

export async function getSpeedConnectedAccountSetupStatus(input: {
  connectedAccountId?: string | null
  accountId?: string | null
}): Promise<CreateOrLinkSpeedConnectedAccountResult> {
  const config = getPineTreeSpeedConfigStatus()
  const connectedAccountId = String(input.connectedAccountId || "").trim()
  const accountId = String(input.accountId || "").trim()

  try {
    let account: SpeedConnectedAccountObject | null = null
    if (connectedAccountId && connectedAccountId.startsWith("ca_")) {
      account = await retrieveSpeedConnectedAccount(connectedAccountId)
    } else if (accountId) {
      const list = await listSpeedConnectedAccounts()
      account =
        (Array.isArray(list.data) ? list.data : []).find(
          (candidate) => String(candidate.account_id || "") === accountId
        ) || null
    }

    const summary = summarizeConnectedAccount(account, account ? "existing_connected_account" : "error")
    const accountReference = summary.account_id || summary.connected_account_id
    const readiness = normalizeSpeedConnectedAccountReadiness({
      speedConnectedAccountId: accountReference,
      rawProviderStatus: summary.status,
    })

    return result({
      status: readiness,
      speedConnectedAccountId: readiness === "ready" ? accountReference : accountReference,
      speedConnectedAccountStatus: summary.status || (account ? "unknown" : "not_found"),
      summary,
      errorMessage: account ? null : "Speed connected account was not found.",
      mode: config.mode,
      usedLiveApi: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speed connected account lookup failed."
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "lookup_failed",
      summary: emptySummary("error"),
      errorMessage: message,
      mode: config.mode,
      usedLiveApi: true,
    })
  }
}

export async function createOrLinkSpeedConnectedAccountForMerchant(
  input: CreateOrLinkSpeedConnectedAccountInput
): Promise<CreateOrLinkSpeedConnectedAccountResult> {
  const config = getPineTreeSpeedConfigStatus()

  if (!isSpeedConnectEnabled()) {
    return result({
      status: "pending",
      speedConnectedAccountStatus: "speed_connect_disabled",
      summary: emptySummary("not_configured"),
      errorMessage: "Speed Connect is disabled until SPEED_CONNECT_ENABLED=true is configured.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  const apiKeyPresent = Boolean(String(process.env.SPEED_API_KEY || "").trim())
  if (!apiKeyPresent) {
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_api_key_missing",
      summary: emptySummary("not_configured"),
      errorMessage: "PineTree Speed platform is missing SPEED_API_KEY.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  if (config.environmentKeyMismatch) {
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_platform_configuration_invalid",
      summary: emptySummary("not_configured"),
      errorMessage: "Speed platform configuration has an environment/key mismatch.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  if (input.merchant_email) {
    try {
      const existing = await findExistingConnectedAccountByEmail(input.merchant_email)
      if (existing) {
        const summary = summarizeConnectedAccount(existing, "existing_connected_account")
        const accountReference = summary.account_id || summary.connected_account_id
        const readiness = normalizeSpeedConnectedAccountReadiness({
          speedConnectedAccountId: accountReference,
          rawProviderStatus: summary.status,
        })
        return result({
          status: readiness,
          speedConnectedAccountId: accountReference,
          speedConnectedAccountStatus: summary.status,
          summary,
          mode: config.mode,
          usedLiveApi: true,
        })
      }
    } catch {
      // Continue to invite link creation. Listing can fail in some Speed accounts
      // while invite creation is still available.
    }
  }

  const returnUrl = getSpeedConnectReturnUrl(input.merchant_id)
  if (!returnUrl) {
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_connect_return_url_missing",
      summary: emptySummary("not_configured"),
      errorMessage: "SPEED_CONNECT_RETURN_URL must be configured before creating a Speed Connect invite.",
      mode: config.mode,
      usedLiveApi: false,
    })
  }

  try {
    const invite = await createSpeedConnectAccountLink({ returnUrl })
    const setupUrl = String(invite.link || "").trim()
    if (!setupUrl) {
      return result({
        status: "needs_attention",
        speedConnectedAccountStatus: "speed_connect_invite_missing_link",
        summary: emptySummary("error"),
        errorMessage: "Speed Connect invite did not return an onboarding link.",
        mode: config.mode,
        usedLiveApi: true,
      })
    }

    return result({
      status: "pending",
      speedConnectedAccountStatus: "speed_connect_invite_created",
      setupUrl,
      summary: inviteLinkSummary(setupUrl),
      mode: config.mode,
      usedLiveApi: true,
    })
  } catch (error) {
    return result({
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_connect_invite_failed",
      summary: emptySummary("error"),
      errorMessage: safeProviderErrorMessage(error, "Speed Connect invite creation failed."),
      mode: config.mode,
      usedLiveApi: true,
    })
  }
}
