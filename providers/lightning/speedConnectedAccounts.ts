/**
 * Server-side Speed Connect provisioning helper.
 *
 * PineTree Wallet uses PineTree's Speed platform account for Lightning.
 * Merchants never provide Speed API keys, NWC strings, or Speed dashboard setup
 * details through the wallet setup UI.
 */

import {
  createSpeedConnectAccountLink,
  getPineTreeSpeedConfigStatus,
  listSpeedConnectedAccounts,
  retrieveSpeedConnectedAccount,
  type SpeedConnectedAccountObject,
  type SpeedMode,
} from "./speedClient"

export type SpeedConnectedAccountReadiness = "pending" | "ready" | "needs_attention"

export type CreateOrLinkSpeedConnectedAccountInput = {
  merchant_id: string
  business_name?: string | null
  merchant_email?: string | null
  pinetree_reference_id: string
}

export type SpeedConnectedAccountSummary = {
  connected_account_id: string | null
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
  speed_connected_account_status: string | null
  setup_url: string | null
  provider_response_summary: SpeedConnectedAccountSummary
  error_message: string | null
  raw_provider_status: string
  readiness: SpeedConnectedAccountReadiness
  mode: SpeedMode
  used_live_api: boolean
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
}): CreateOrLinkSpeedConnectedAccountResult {
  const providerStatus = input.speedConnectedAccountStatus || input.summary.status || input.status
  return {
    status: input.status,
    speed_connected_account_id: input.speedConnectedAccountId || null,
    speed_connected_account_status: input.speedConnectedAccountStatus || null,
    setup_url: input.setupUrl || null,
    provider_response_summary: input.summary,
    error_message: input.errorMessage || null,
    raw_provider_status: providerStatus,
    readiness: input.status,
    mode: input.mode,
    used_live_api: input.usedLiveApi,
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
