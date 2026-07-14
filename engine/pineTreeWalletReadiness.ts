/**
 * PineTree Wallet -> Lightning readiness.
 *
 * PineTree Wallet is the canonical setup surface for Bitcoin Lightning.
 * ensureManagedLightningForMerchant is the single entry point that keeps a
 * merchant's Speed Custom Connect connected account provisioned server-side —
 * merchants never see a Speed signup/OAuth flow.
 */

import { createHash } from "node:crypto"
import {
  getMerchantLightningProfile,
  upsertMerchantLightningProfile,
  type MerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { saveMerchantSpeedConnection } from "@/database/merchantProviders"
import { getMerchantSpeedCredentialMetadata } from "@/database/merchantSpeedCredentials"
import {
  createSpeedCustomConnectedAccountForMerchant,
  getSpeedConnectedAccountSetupStatus
} from "@/providers/lightning/speedConnectedAccounts"
import { getMerchantBusinessProfile } from "@/engine/businessProfile"
import { withOperationTimeout, OperationTimeoutError } from "@/engine/promiseTimeout"
import {
  getPineTreeSpeedConfigStatus,
  getSpeedApiHost,
  isSpeedPlatformTreasurySweepEnabled,
  normalizeSpeedCountry,
  SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE,
  type SpeedFieldError,
} from "@/providers/lightning/speedClient"

export type EnsureManagedLightningAction =
  | "already_active"
  | "existing_account_checked"
  | "existing_credential_recovered"
  | "provisioned"
  | "provisioning_incomplete"
  | "needs_business_profile"
  | "needs_business_owner_profile"
  | "needs_valid_country"
  | "rejection_unchanged"
  | "treasury_sweep_mode"

export type EnsureManagedLightningResult = {
  status: MerchantLightningProfileStatus
  action: EnsureManagedLightningAction
  speedConnectedAccountId: string | null
  speedConnectedAccountRelationshipId: string | null
  speedConnectedAccountStatus: string | null
  // Speed's own error code and sanitized per-field validation messages from the
  // most recent /connect/custom attempt, when one failed. Null/empty otherwise.
  providerCode: string | null
  fieldErrors: SpeedFieldError[]
  // Canned, merchant-safe copy (never Speed's raw message) - null when ready/pending.
  merchantMessage: string | null
}

export type EnsureManagedLightningOptions = {
  authEmail?: string | null
  // Bypasses the "unchanged profile after a deterministic rejection" retry
  // gate for exactly one attempt. Set from an explicit merchant-initiated
  // retry action, never from the automatic on-open provisioning call.
  forceRetry?: boolean
}

/**
 * Stable fingerprint of the exact fields that feed the Speed /connect/custom
 * request body (country, account_type, first_name, last_name, email). Used to
 * decide whether a previously-rejected profile has actually changed before
 * allowing another automatic attempt. Deliberately mirrors the documented
 * six-field contract (password is generated fresh per attempt and excluded) -
 * a fix to how any of these fields is derived changes the fingerprint too,
 * so a corrected request is never suppressed by a stale rejection.
 */
export function computeSpeedCustomConnectFingerprint(input: {
  country: string
  accountType: string
  firstName: string
  lastName: string
  email: string
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.country,
      input.accountType,
      input.firstName,
      input.lastName,
      input.email,
    ]))
    .digest("hex")
    .slice(0, 32)
}

/**
 * Canned, merchant-safe copy for a Lightning profile in needs_attention.
 * Never surfaces Speed's raw provider message - only a category-level string.
 */
export function getLightningNeedsAttentionMerchantMessage(input: {
  providerHttpStatus?: number | null
  fieldErrorCount?: number
}): string {
  const status = input.providerHttpStatus ?? null
  if (status != null && status >= 400 && status < 500 && (input.fieldErrorCount ?? 0) > 0) {
    return "Review your Business Profile information to finish Bitcoin setup."
  }
  if (status == null || status >= 500) {
    return "Bitcoin setup is temporarily unavailable. Try again."
  }
  return "Bitcoin setup needs attention."
}

const SPEED_CUSTOM_CONNECT_TIMEOUT_MS = 10_000

/** A profile counts as active only when it has acct_ account id AND Speed status active. */
function isActiveLightningProfile(profile: MerchantLightningProfile | null): boolean {
  if (!profile) return false
  const accountId = speedAccountId(profile.speed_account_id)
  const status = String(profile.speed_connected_account_status || "").trim().toLowerCase()
  return Boolean(accountId) && status === "active"
}

/**
 * Speed Custom Connect requires a password at account-creation time, but
 * PineTree Wallet merchants never log into Speed directly. For the MVP,
 * PineTree resolves one unified server-side password from Vercel and never
 * persists that password in Supabase.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidSpeedCustomConnectEmail(value?: string | null): boolean {
  const email = String(value || "").trim().toLowerCase()
  return email.length <= 320 && EMAIL_RE.test(email)
}

export function buildManagedSpeedEmail(merchantId: string): string {
  const compactMerchantId = String(merchantId || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!compactMerchantId) {
    throw new Error("Valid merchant id is required to create a managed Speed email.")
  }
  return `speed-${compactMerchantId}@speed.pinetree-payments.com`
}

export function speedCustomConnectPasswordPolicyPass(value?: string | null): boolean {
  const password = String(value || "")
  if (password.length < 12 || password.length > 128) return false
  if (/\s/.test(password)) return false
  if (!/[a-z]/.test(password)) return false
  if (!/[A-Z]/.test(password)) return false
  if (!/[0-9]/.test(password)) return false
  if (!/[!#$%&()*+\-.:;=?@[\]^_{}~]/.test(password)) return false
  if (/(.)\1\1/.test(password)) return false
  if (/abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|123|234|345|456|567|678|789/i.test(password)) {
    return false
  }
  return true
}

/**
 * One unified server-side password for Speed Custom Connect accounts. PineTree
 * administrators manage it in Vercel; it is never logged, returned to the
 * browser, or stored in Supabase.
 */
export function resolveSpeedAccountPassword(): string {
  const password = String(process.env.SPEED_CONNECTED_ACCOUNT_PASSWORD || "").trim()
  if (!password) {
    throw new Error(
      "SPEED_CONNECTED_ACCOUNT_PASSWORD is required to create Speed Custom Connect accounts."
    )
  }
  return password
}

function normalizeSpeedProviderStatus(value?: string | null): string | null {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized || null
}

function isActiveSpeedStatus(value?: string | null): boolean {
  return normalizeSpeedProviderStatus(value) === "active"
}

function speedAccountId(value?: string | null): string | null {
  const id = String(value || "").trim()
  return id.startsWith("acct_") ? id : null
}

function speedRelationshipId(value?: string | null): string | null {
  const id = String(value || "").trim()
  return id.startsWith("ca_") ? id : null
}

function deriveSpeedIntakeStatus(input: {
  speedAccountId?: string | null
  providerStatus?: string | null
  fallback: MerchantLightningProfileStatus
}): MerchantLightningProfileStatus {
  if (input.speedAccountId && isActiveSpeedStatus(input.providerStatus)) return "ready"
  if (input.fallback === "needs_attention") return "needs_attention"
  return "pending"
}

function logSpeedProvisioningDiagnostic(input: {
  merchantId: string
  speedRequestAttempted: boolean
  speedRequestCompleted: boolean
  speedResponseOk: boolean
  connectionIdPresent: boolean
  accountIdPresent: boolean
  providerStatusPresent: boolean
  providerStatusNormalized: string | null
  unifiedPasswordConfigured: boolean
  credentialResolved: boolean
  profileUpsertAttempted: boolean
  profileUpsertSucceeded: boolean
  readinessEvaluated: boolean
  finalSpeedConnected: boolean
  failureStage: string | null
  safeErrorCode: string | null
  elapsedMs: number
}) {
  console.info("[pinetree-managed-lightning] speed_custom_connect_stage_diagnostic", input)
}

async function syncLightningStatusIntoWalletProfile(
  merchantId: string,
  lightningProfile: MerchantLightningProfile
) {
  const walletProfile = await getPineTreeWalletProfile(merchantId)
  if (!walletProfile) return

  await upsertPineTreeWalletProfile({
    merchantId,
    bitcoinLightningStatus: lightningProfile.status,
    bitcoinLightningProvider: "speed",
    bitcoinLightningAccountId:
      lightningProfile.speed_account_id || lightningProfile.speed_connected_account_id,
    bitcoinLightningReceiveMode: "invoice",
  })
}

/**
 * Ensures a merchant's Lightning rail is backed by an active Speed Custom
 * Connect connected account.
 *
 *  - If merchant_lightning_profiles already has an active account: no-op.
 *  - If the merchant hasn't completed their Business Profile yet: marks the
 *    profile needs_attention and returns
 *    without calling Speed — there is nothing to submit yet.
 *  - Otherwise: calls the existing Speed Custom Connect helper and persists
 *    both the ca_ relationship id and the acct_ connected account id.
 *
 * Cheap to call on every PineTree Wallet open: the common case (already
 * active) short-circuits on a single DB read before any Speed API call.
 */
async function ensureManagedLightningForMerchantImpl(
  merchantId: string,
  options: EnsureManagedLightningOptions = {}
): Promise<EnsureManagedLightningResult> {
  const existing = await getMerchantLightningProfile(merchantId)

  if (isActiveLightningProfile(existing)) {
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_existing", {
      merchant_id: merchantId,
      status: "ready",
      existingProfileFound: true,
      setupUrlPresent: false,
    })
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_complete", {
      merchant_id: merchantId,
      status: "ready",
    })
    return {
      status: "ready",
      action: "already_active",
      speedConnectedAccountId: speedAccountId(existing!.speed_account_id) || existing!.speed_connected_account_id,
      speedConnectedAccountRelationshipId: speedRelationshipId(existing!.speed_connected_account_relationship_id),
      speedConnectedAccountStatus: existing!.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  }

  if (isSpeedPlatformTreasurySweepEnabled()) {
    // Treasury-sweep settlement uses PineTree's platform Speed account directly;
    // it has no per-merchant Speed Custom Connect account to provision.
    const speedConfig = getPineTreeSpeedConfigStatus()
    console.info("[pinetree-managed-lightning] treasury_sweep_post_start", {
      merchant_id: merchantId,
      lightning_provider: process.env.PINE_TREE_LIGHTNING_PROVIDER || "",
      settlement_mode: process.env.PINE_TREE_LIGHTNING_SETTLEMENT_MODE || "",
      SPEED_API_KEY_present: Boolean(String(process.env.SPEED_API_KEY || "").trim()),
      SPEED_WEBHOOK_SECRET_present: Boolean(String(process.env.SPEED_WEBHOOK_SECRET || "").trim()),
      SPEED_API_BASE_URL: speedConfig.apiBaseUrl,
    })

    const walletProfile = await getPineTreeWalletProfile(merchantId)
    const btcAddressReady = Boolean(walletProfile?.btc_address && walletProfile.btc_payout_enabled)
    const status: MerchantLightningProfileStatus = !speedConfig.configured
      ? "needs_attention"
      : !btcAddressReady
        ? "pending"
        : "ready"

    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status,
      speedConnectedAccountId: null,
      speedConnectedAccountStatus: speedConfig.configured
        ? btcAddressReady ? "pinetree_wallet_btc_payout_ready" : "btc_address_missing_internal"
        : "speed_platform_config_missing",
      speedConnectSetupUrl: null,
      providerResponseSummary: {
        source: "speed_platform_treasury_sweep",
        settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
        speed_configured: speedConfig.configured,
        speed_missing: speedConfig.missing,
        btc_address_present: Boolean(walletProfile?.btc_address),
        btc_payout_enabled: Boolean(walletProfile?.btc_payout_enabled),
        internal_readiness_issue: btcAddressReady ? null : "btc_address_missing",
      },
      providerErrorMessage: speedConfig.configured
        ? null
        : `PineTree Speed platform missing: ${speedConfig.missing.join(", ")}`,
    })

    if (walletProfile) {
      await upsertPineTreeWalletProfile({
        merchantId,
        bitcoinLightningStatus: status,
        bitcoinLightningProvider: "speed",
        bitcoinLightningAccountId: null,
        bitcoinLightningReceiveMode: "invoice",
      })
    }

    console.info("[pinetree-managed-lightning] treasury_sweep_profile_saved", {
      merchant_id: merchantId,
      final_saved_profile_status: lightningProfile.status,
      btc_address_present: Boolean(walletProfile?.btc_address),
    })

    return {
      status: lightningProfile.status,
      action: "treasury_sweep_mode",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  }

  const existingAccountId = speedAccountId(existing?.speed_account_id) || speedAccountId(existing?.speed_connected_account_id)
  const existingRelationshipId = speedRelationshipId(existing?.speed_connected_account_relationship_id) || speedRelationshipId(existing?.speed_connected_account_id)
  if (existingAccountId || existingRelationshipId) {
    const checked = await getSpeedConnectedAccountSetupStatus({
      connectedAccountId: existingRelationshipId || null,
      accountId: existingAccountId || null,
    })
    const checkedProviderStatus = normalizeSpeedProviderStatus(checked.speed_connected_account_status)
    const checkedAccountId = speedAccountId(checked.speed_account_id) || existingAccountId
    const checkedRelationshipId = speedRelationshipId(checked.speed_connected_account_relationship_id) || existingRelationshipId
    const checkedStatus = deriveSpeedIntakeStatus({
      speedAccountId: checkedAccountId,
      providerStatus: checkedProviderStatus,
      fallback: checked.readiness,
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: checkedStatus,
      speedConnectedAccountId: checkedAccountId || checkedRelationshipId || null,
      speedConnectedAccountRelationshipId: checkedRelationshipId,
      speedAccountId: checkedAccountId,
      speedConnectedAccountStatus: checkedProviderStatus || checked.speed_connected_account_status,
      speedConnectSetupUrl: checked.setup_url,
      providerResponseSummary: checked.provider_response_summary,
      providerErrorMessage: checked.error_message,
    })
    if (lightningProfile.speed_account_id) {
      await saveMerchantSpeedConnection(merchantId, {
        accountId: lightningProfile.speed_account_id,
        accountStatus: lightningProfile.speed_connected_account_status || undefined,
        setupStatus: lightningProfile.status === "ready" ? "ready_for_payments" : lightningProfile.status,
        mode: checked.mode,
        managedAccountEmail: String(checked.provider_response_summary?.managed_account_email || "") || undefined,
        enabled: lightningProfile.status === "ready",
        notes: [
          "PineTree created this Speed Custom Connect merchant account server-side.",
          "Payments use the connected account account_id, not the ca_ relationship id.",
        ],
      })
    }
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_existing", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      existingProfileFound: true,
      setupUrlPresent: Boolean(lightningProfile.speed_connect_setup_url),
    })
    if (lightningProfile.status === "ready") {
      console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_complete", {
        merchant_id: merchantId,
        status: lightningProfile.status,
      })
    } else if (lightningProfile.status === "pending") {
      console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_pending", {
        merchant_id: merchantId,
        status: lightningProfile.status,
        setupUrlPresent: Boolean(lightningProfile.speed_connect_setup_url),
      })
    }
    return {
      status: lightningProfile.status,
      action: "existing_account_checked",
      speedConnectedAccountId:
        speedAccountId(lightningProfile.speed_account_id) || lightningProfile.speed_connected_account_id,
      speedConnectedAccountRelationshipId: speedRelationshipId(lightningProfile.speed_connected_account_relationship_id),
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  }

  const credentialMetadata = await getMerchantSpeedCredentialMetadata(merchantId).catch(() => null)
  const credentialAccountReference = String(credentialMetadata?.speed_connected_account_id || "").trim()
  const credentialAccountId = speedAccountId(credentialAccountReference)
  const credentialRelationshipId = speedRelationshipId(credentialAccountReference)
  if (credentialAccountId || credentialRelationshipId) {
    const recoveryStartedAt = Date.now()
    let profileUpsertAttempted = false
    let profileUpsertSucceeded = false
    try {
      const checked = await getSpeedConnectedAccountSetupStatus({
        connectedAccountId: credentialRelationshipId,
        accountId: credentialAccountId,
      })
      const checkedProviderStatus = normalizeSpeedProviderStatus(checked.speed_connected_account_status)
      const checkedAccountId = speedAccountId(checked.speed_account_id) || credentialAccountId
      const checkedRelationshipId = speedRelationshipId(checked.speed_connected_account_relationship_id) || credentialRelationshipId
      const checkedStatus = deriveSpeedIntakeStatus({
        speedAccountId: checkedAccountId,
        providerStatus: checkedProviderStatus,
        fallback: checked.readiness,
      })
      profileUpsertAttempted = true
      const lightningProfile = await upsertMerchantLightningProfile({
        merchantId,
        status: checkedStatus,
        speedConnectedAccountId: checkedAccountId || checkedRelationshipId,
        speedConnectedAccountRelationshipId: checkedRelationshipId,
        speedAccountId: checkedAccountId,
        speedConnectedAccountStatus: checkedProviderStatus || checked.speed_connected_account_status,
        speedConnectSetupUrl: checked.setup_url,
        providerResponseSummary: checked.provider_response_summary,
        providerErrorMessage: checked.error_message,
      })
      profileUpsertSucceeded = true
      if (lightningProfile.speed_account_id) {
        await saveMerchantSpeedConnection(merchantId, {
          accountId: lightningProfile.speed_account_id,
          accountStatus: lightningProfile.speed_connected_account_status || undefined,
          setupStatus: lightningProfile.status === "ready" ? "ready_for_payments" : lightningProfile.status,
          mode: checked.mode,
          managedAccountEmail: String(checked.provider_response_summary?.managed_account_email || "") || undefined,
          enabled: lightningProfile.status === "ready",
          notes: [
            "PineTree recovered this Speed Custom Connect merchant account from local server-side metadata.",
            "Payments use the connected account account_id, not the ca_ relationship id.",
          ],
        })
      }
      await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
      logSpeedProvisioningDiagnostic({
        merchantId,
        speedRequestAttempted: false,
        speedRequestCompleted: false,
        speedResponseOk: Boolean(checkedAccountId && isActiveSpeedStatus(checkedProviderStatus)),
        connectionIdPresent: Boolean(lightningProfile.speed_connected_account_relationship_id),
        accountIdPresent: Boolean(lightningProfile.speed_account_id),
        providerStatusPresent: Boolean(lightningProfile.speed_connected_account_status),
        providerStatusNormalized: normalizeSpeedProviderStatus(lightningProfile.speed_connected_account_status),
        unifiedPasswordConfigured: Boolean(String(process.env.SPEED_CONNECTED_ACCOUNT_PASSWORD || "").trim()),
        credentialResolved: true,
        profileUpsertAttempted,
        profileUpsertSucceeded,
        readinessEvaluated: true,
        finalSpeedConnected: Boolean(lightningProfile.speed_account_id && isActiveSpeedStatus(lightningProfile.speed_connected_account_status)),
        failureStage: lightningProfile.status === "ready" ? null : "existing_credential_recovery_incomplete",
        safeErrorCode: checked.speed_connected_account_status || null,
        elapsedMs: Date.now() - recoveryStartedAt,
      })
      return {
        status: lightningProfile.status,
        action: "existing_credential_recovered",
        speedConnectedAccountId:
          speedAccountId(lightningProfile.speed_account_id) || lightningProfile.speed_connected_account_id,
        speedConnectedAccountRelationshipId: speedRelationshipId(lightningProfile.speed_connected_account_relationship_id),
        speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
        providerCode: null,
        fieldErrors: [],
        merchantMessage: lightningProfile.status === "needs_attention" ? "Bitcoin setup needs attention." : null,
      }
    } catch (error) {
      logSpeedProvisioningDiagnostic({
        merchantId,
        speedRequestAttempted: false,
        speedRequestCompleted: false,
        speedResponseOk: false,
        connectionIdPresent: Boolean(credentialRelationshipId),
        accountIdPresent: Boolean(credentialAccountId),
        providerStatusPresent: false,
        providerStatusNormalized: null,
        unifiedPasswordConfigured: Boolean(String(process.env.SPEED_CONNECTED_ACCOUNT_PASSWORD || "").trim()),
        credentialResolved: true,
        profileUpsertAttempted,
        profileUpsertSucceeded,
        readinessEvaluated: false,
        finalSpeedConnected: false,
        failureStage: "existing_credential_recovery_failed",
        safeErrorCode: "recovery_failed",
        elapsedMs: Date.now() - recoveryStartedAt,
      })
      throw error
    }
  }

  const businessProfile = await getMerchantBusinessProfile(merchantId)

  if (businessProfile.profile_status !== "complete") {
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "business_owner_profile_required",
      providerErrorMessage:
        "Complete your Business Profile to activate payments.",
    })
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      safeReason: "business_owner_profile_required",
    })
    return {
      status: lightningProfile.status,
      action: "needs_business_owner_profile",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  }

  const speedEmail = buildManagedSpeedEmail(merchantId)

  const speedPassword = resolveSpeedAccountPassword()
  const passwordPolicyPass = speedCustomConnectPasswordPolicyPass(speedPassword)
  console.info("[pinetree-managed-lightning] speed_connect_password_resolved", {
    merchant_id: merchantId,
    unifiedPasswordConfigured: Boolean(String(process.env.SPEED_CONNECTED_ACCOUNT_PASSWORD || "").trim()),
    passwordPolicyPass,
  })
  console.info("[pinetree-managed-lightning] speed_connect_payload_validated", {
    merchant_id: merchantId,
    emailPresent: Boolean(speedEmail),
    emailValid: isValidSpeedCustomConnectEmail(speedEmail),
    passwordPresent: Boolean(speedPassword),
    passwordPolicyPass,
  })

  if (!passwordPolicyPass) {
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_connect_password_policy_failed",
      providerErrorMessage: "Lightning provisioning needs attention.",
    })
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      safeReason: "password_policy_failed",
    })
    return {
      status: lightningProfile.status,
      action: "provisioning_incomplete",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  }

  const speedCountry = normalizeSpeedCountry(businessProfile.business_country)
  if (!speedCountry) {
    console.warn("[pinetree-managed-lightning] speed_country_unsupported", {
      merchant_id: merchantId,
      businessCountryPresent: Boolean(businessProfile.business_country),
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "needs_valid_country",
      providerErrorMessage: "Review your Business Profile country to finish Bitcoin setup.",
    })
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      safeReason: "country_unsupported",
    })
    return {
      status: lightningProfile.status,
      action: "needs_valid_country",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: "Review your Business Profile country to finish Bitcoin setup.",
    }
  }

  // TEMPORARY diagnostic: country is not secret/personal data. Records the
  // exact outgoing provider-bound value alongside what was actually stored,
  // so a future Speed rejection is traceable without guessing. Remove once
  // production has proven a successful Active account creation.
  console.info("[pinetree-managed-lightning] speed_custom_connect_country_diagnostic", {
    merchant_id: merchantId,
    stored_country: businessProfile.business_country,
    provider_country: speedCountry,
    account_type: SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE,
    api_host: getSpeedApiHost(),
  })

  // last_name carries the business name (Speed's own documentation example
  // uses a business name, "CVS") - DBA first, legal business name next, and
  // the owner's last name only as a final defensive fallback if neither
  // business name field is on file.
  const speedLastName = businessProfile.business_dba || businessProfile.legal_business_name || businessProfile.owner_last_name!
  const requestFingerprint = computeSpeedCustomConnectFingerprint({
    country: speedCountry,
    accountType: SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE,
    firstName: businessProfile.owner_first_name!,
    lastName: speedLastName,
    email: speedEmail,
  })

  // A deterministic Speed validation rejection (4xx) must not be retried
  // automatically on every wallet open - only when the fingerprinted profile
  // fields have actually changed, or the caller asked for an explicit retry.
  const existingSummary = existing?.provider_response_summary ?? null
  const priorFingerprint = String(existingSummary?.speed_request_fingerprint || "")
  const priorWasDeterministicRejection = existing?.speed_connected_account_status === "speed_custom_connect_rejected"
  if (priorWasDeterministicRejection && priorFingerprint === requestFingerprint && !options.forceRetry) {
    const priorFieldErrors = (existingSummary?.field_errors as SpeedFieldError[] | undefined) ?? []
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: "needs_attention",
      safeReason: "deterministic_rejection_unchanged",
    })
    return {
      status: "needs_attention",
      action: "rejection_unchanged",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: existing?.speed_connected_account_status ?? null,
      providerCode: (existingSummary?.provider_code as string | undefined) ?? null,
      fieldErrors: priorFieldErrors,
      merchantMessage: getLightningNeedsAttentionMerchantMessage({
        providerHttpStatus: 400,
        fieldErrorCount: priorFieldErrors.length,
      }),
    }
  }

  const speedStartedAt = Date.now()
  console.info("[pinetree-managed-lightning] provisioning_step", {
    merchant_id: merchantId,
    step: "speed_custom_connect_start",
  })
  let speedSetup: Awaited<ReturnType<typeof createSpeedCustomConnectedAccountForMerchant>>
  try {
    speedSetup = await withOperationTimeout(
      createSpeedCustomConnectedAccountForMerchant({
        merchant_id: merchantId,
        country: speedCountry,
        first_name: businessProfile.owner_first_name!,
        last_name: speedLastName,
        email: speedEmail,
        password: speedPassword,
        email_valid: isValidSpeedCustomConnectEmail(speedEmail),
        password_policy_valid: passwordPolicyPass,
      }),
      SPEED_CUSTOM_CONNECT_TIMEOUT_MS,
      "Speed Custom Connect"
    )
  } catch (error) {
    console.warn("[pinetree-managed-lightning] speed_custom_connect_failed", {
      merchant_id: merchantId,
      error: error instanceof Error ? error.message : String(error),
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_custom_connect_failed",
      providerErrorMessage: "Lightning provisioning needs attention.",
    })
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    if (error instanceof OperationTimeoutError) {
      console.warn("[pinetree-managed-lightning] wallet_lightning_auto_provision_timeout", {
        merchant_id: merchantId,
        elapsed_ms: Date.now() - speedStartedAt,
      })
    } else {
      console.warn("[pinetree-managed-lightning] wallet_lightning_auto_provision_failed", {
        merchant_id: merchantId,
        elapsed_ms: Date.now() - speedStartedAt,
      })
    }
    return {
      status: lightningProfile.status,
      action: "provisioning_incomplete",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      // createSpeedCustomConnectedAccountForMerchant catches Speed API failures
      // itself and resolves with provider_code/field_errors on speedSetup (see
      // the success/incomplete return below) rather than rejecting - this catch
      // only fires for a genuine timeout or another unexpected throw, neither of
      // which carries a provider response to report.
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  } finally {
    console.info("[pinetree-managed-lightning] provisioning_timing", {
      merchant_id: merchantId,
      step: "speed_custom_connect_complete",
      duration_ms: Date.now() - speedStartedAt,
    })
  }

  const normalizedSpeedStatus = normalizeSpeedProviderStatus(speedSetup.speed_connected_account_status)
  const createdAccountId = speedAccountId(speedSetup.speed_account_id)
  const createdRelationshipId = speedRelationshipId(speedSetup.speed_connected_account_relationship_id)
  const status = deriveSpeedIntakeStatus({
    speedAccountId: createdAccountId,
    providerStatus: normalizedSpeedStatus,
    fallback: speedSetup.readiness,
  })

  // A 4xx from Speed is a deterministic validation rejection - distinguish it
  // from a generic/transient failure so the fingerprint-unchanged retry gate
  // (above) only ever suppresses retries for the case it's meant for.
  const isDeterministicRejection = Boolean(
    speedSetup.provider_http_status && speedSetup.provider_http_status >= 400 && speedSetup.provider_http_status < 500
  )
  const speedConnectedAccountStatus = status === "needs_attention" && isDeterministicRejection
      ? "speed_custom_connect_rejected"
      : normalizedSpeedStatus || speedSetup.speed_connected_account_status
  const speedFieldErrors = speedSetup.field_errors || []
  const merchantMessage = status === "needs_attention"
    ? getLightningNeedsAttentionMerchantMessage({
        providerHttpStatus: speedSetup.provider_http_status,
        fieldErrorCount: speedFieldErrors.length,
      })
    : null

  const lightningProfile = await upsertMerchantLightningProfile({
    merchantId,
    status,
    speedConnectedAccountId: createdAccountId || createdRelationshipId,
    speedConnectedAccountRelationshipId: createdRelationshipId,
    speedAccountId: createdAccountId,
    speedConnectedAccountStatus,
    speedConnectSetupUrl: speedSetup.setup_url,
    // Persist Speed's own error code, sanitized field errors, and the request
    // fingerprint alongside the existing response summary so a rejected
    // /connect/custom attempt is diagnosable from the saved row (not just the
    // request-time logs) and so the next call can tell whether the Business
    // Profile actually changed before allowing another automatic attempt.
    providerResponseSummary: {
      ...speedSetup.provider_response_summary,
      managed_account_email: speedEmail,
      ...(speedSetup.provider_code ? { provider_code: speedSetup.provider_code } : {}),
      ...(speedFieldErrors.length > 0 ? { field_errors: speedFieldErrors } : {}),
      speed_request_fingerprint: requestFingerprint,
    },
    // Merchant-safe canned copy only - Speed's raw provider_message never
    // leaves the structured log/diagnostic event.
    providerErrorMessage: merchantMessage,
  })

  if (lightningProfile.speed_account_id) {
    await saveMerchantSpeedConnection(merchantId, {
      accountId: lightningProfile.speed_account_id,
      accountStatus: lightningProfile.speed_connected_account_status || undefined,
      setupStatus: status === "ready" ? "ready_for_payments" : status,
      mode: speedSetup.mode,
      managedAccountEmail: speedEmail,
      enabled: status === "ready",
      notes: [
        "PineTree created this Speed Custom Connect merchant account server-side.",
        "Payments use the connected account account_id, not the ca_ relationship id.",
      ],
    })
  }

  await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)

  logSpeedProvisioningDiagnostic({
    merchantId,
    speedRequestAttempted: true,
    speedRequestCompleted: true,
    speedResponseOk: Boolean(createdAccountId && isActiveSpeedStatus(speedConnectedAccountStatus)),
    connectionIdPresent: Boolean(createdRelationshipId),
    accountIdPresent: Boolean(createdAccountId),
    providerStatusPresent: Boolean(speedConnectedAccountStatus),
    providerStatusNormalized: normalizeSpeedProviderStatus(speedConnectedAccountStatus),
    unifiedPasswordConfigured: Boolean(String(process.env.SPEED_CONNECTED_ACCOUNT_PASSWORD || "").trim()),
    credentialResolved: Boolean(speedPassword),
    profileUpsertAttempted: true,
    profileUpsertSucceeded: true,
    readinessEvaluated: true,
    finalSpeedConnected: Boolean(lightningProfile.speed_account_id && isActiveSpeedStatus(lightningProfile.speed_connected_account_status)),
    failureStage: lightningProfile.status === "ready" ? null : "speed_custom_connect_incomplete",
    safeErrorCode: speedConnectedAccountStatus || null,
    elapsedMs: Date.now() - speedStartedAt,
  })

  console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_created", {
    merchant_id: merchantId,
    status: lightningProfile.status,
    setupUrlPresent: Boolean(lightningProfile.speed_connect_setup_url),
  })
  if (lightningProfile.status === "ready") {
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_complete", {
      merchant_id: merchantId,
      status: lightningProfile.status,
    })
  } else if (lightningProfile.status === "pending") {
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_pending", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      setupUrlPresent: Boolean(lightningProfile.speed_connect_setup_url),
    })
  }

  return {
    status: lightningProfile.status,
    action: status === "ready" ? "provisioned" : "provisioning_incomplete",
    speedConnectedAccountId: speedAccountId(lightningProfile.speed_account_id) || lightningProfile.speed_connected_account_id,
    speedConnectedAccountRelationshipId: speedRelationshipId(lightningProfile.speed_connected_account_relationship_id),
    speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
    providerCode: speedSetup.provider_code ?? null,
    fieldErrors: speedSetup.field_errors || [],
    merchantMessage,
  }
}

// Single-flight guard, keyed by merchant id: concurrent calls for the same merchant
// (React Strict Mode double-invoking an effect, a profile refetch, a retry click, or a
// delayed network retry all landing on the same warm serverless instance) await the
// same in-flight attempt instead of racing two independent reads of
// merchant_lightning_profiles and potentially both reaching the Speed Custom Connect
// create step before either write lands. The durable idempotency record is still the
// database row itself (checked at the top of the impl above and upserted with
// onConflict: "merchant_id"); this only closes the same-process TOCTOU window.
const lightningAutoProvisionInFlight = new Map<string, Promise<EnsureManagedLightningResult>>()

export async function ensureManagedLightningForMerchant(
  merchantId: string,
  options: EnsureManagedLightningOptions = {}
): Promise<EnsureManagedLightningResult> {
  const alreadyInFlight = lightningAutoProvisionInFlight.get(merchantId)
  if (alreadyInFlight) {
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      safeReason: "concurrent_request_in_flight",
    })
    return alreadyInFlight
  }

  const startedAt = Date.now()
  console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_started", {
    merchant_id: merchantId,
  })

  const run = ensureManagedLightningForMerchantImpl(merchantId, options).finally(() => {
    if (lightningAutoProvisionInFlight.get(merchantId) === run) {
      lightningAutoProvisionInFlight.delete(merchantId)
    }
  })
  lightningAutoProvisionInFlight.set(merchantId, run)

  try {
    return await run
  } catch (error) {
    console.warn("[pinetree-managed-lightning] wallet_lightning_auto_provision_failed", {
      merchant_id: merchantId,
      elapsed_ms: Date.now() - startedAt,
    })
    throw error
  }
}
