/**
 * PineTree Wallet -> Lightning readiness.
 *
 * PineTree Wallet is the canonical setup surface for Bitcoin Lightning.
 * ensureManagedLightningForMerchant is the single entry point that keeps a
 * merchant's Speed Custom Connect connected account provisioned server-side —
 * merchants never see a Speed signup/OAuth flow.
 */

import { createHash, randomBytes, randomInt } from "node:crypto"
import { getMerchantById } from "@/database/merchants"
import {
  getMerchantLightningProfile,
  upsertMerchantLightningProfile,
  type MerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { saveMerchantSpeedConnection } from "@/database/merchantProviders"
import {
  createSpeedCustomConnectedAccountForMerchant,
  getSpeedConnectedAccountSetupStatus
} from "@/providers/lightning/speedConnectedAccounts"
import { getMerchantBusinessProfile } from "@/engine/businessProfile"
import { withOperationTimeout, OperationTimeoutError } from "@/engine/promiseTimeout"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE,
  type SpeedFieldError,
} from "@/providers/lightning/speedClient"

export type EnsureManagedLightningAction =
  | "already_active"
  | "existing_account_checked"
  | "provisioned"
  | "provisioning_incomplete"
  | "needs_business_profile"
  | "needs_business_owner_profile"
  | "needs_valid_phone"
  | "needs_supported_business_type"
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

const SPEED_BUSINESS_TYPE_TO_ACCOUNT_TYPE: Record<string, string> = {
  retail: "merchant",
  restaurant: "merchant",
  services: "merchant",
  online: "merchant",
}

/**
 * Maps PineTree's Business Profile `business_type` UI label to the enum value
 * Speed's /connect/custom `account_type` field expects. Returns null for a
 * missing/unrecognized value so the caller can stop before issuing a request
 * Speed is guaranteed to reject, rather than forwarding PineTree's raw label.
 */
export function mapBusinessTypeToSpeedAccountType(businessType?: string | null): string | null {
  const key = String(businessType || "").trim().toLowerCase()
  if (!key) return null
  return SPEED_BUSINESS_TYPE_TO_ACCOUNT_TYPE[key] ?? null
}

const US_PHONE_10_DIGIT_RE = /^\d{10}$/

/**
 * Normalizes a US phone number to E.164 (+1XXXXXXXXXX). Accepts 10-digit
 * national numbers, 11-digit numbers with a leading country-code 1, or an
 * already-E.164 +1 number. Returns null for anything else instead of
 * manufacturing a number - the caller must treat null as "reject locally".
 */
export function normalizeUsPhoneToE164(value?: string | null): string | null {
  const raw = String(value || "").trim()
  if (!raw) return null
  if (/^\+1\d{10}$/.test(raw)) return raw
  const digits = raw.replace(/\D/g, "")
  if (US_PHONE_10_DIGIT_RE.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1") && US_PHONE_10_DIGIT_RE.test(digits.slice(1))) {
    return `+1${digits.slice(1)}`
  }
  return null
}

/**
 * Stable fingerprint of the Business Profile fields that feed the Speed
 * /connect/custom request. Used to decide whether a previously-rejected
 * profile has actually changed before allowing another automatic attempt.
 */
export function computeSpeedCustomConnectFingerprint(input: {
  country: string
  firstName: string
  lastName: string
  businessName: string
  email: string
  accountType: string
  phone: string
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.country,
      input.firstName,
      input.lastName,
      input.businessName,
      input.email,
      input.accountType,
      input.phone,
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

const ACTIVE_SPEED_ACCOUNT_STATUSES = new Set([
  "active",
  "ready",
  "ready_for_payments",
  "approved",
  "enabled",
  "connected",
  "verified",
])
const SPEED_CUSTOM_CONNECT_TIMEOUT_MS = 10_000

/** A profile counts as active only when it has a real account id AND an active-looking status. */
function isActiveLightningProfile(profile: MerchantLightningProfile | null): boolean {
  if (!profile) return false
  const accountId = String(profile.speed_account_id || profile.speed_connected_account_id || "").trim()
  const status = String(profile.speed_connected_account_status || "").trim().toLowerCase()
  return Boolean(accountId) && (profile.status === "ready" || ACTIVE_SPEED_ACCOUNT_STATUSES.has(status))
}

/**
 * Speed Custom Connect requires a password at account-creation time, but
 * PineTree Wallet merchants never log into Speed directly — generate one,
 * hand it to Speed, and discard it immediately.
 */
const SPEED_PASSWORD_LOWER = "abcdefghjkmnpqrstuvwxyz"
const SPEED_PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const SPEED_PASSWORD_NUMBER = "23456789"
const SPEED_PASSWORD_SPECIAL = "!#$%&()*+-.:;=?@[]^_{}~"
const SPEED_PASSWORD_ALL = `${SPEED_PASSWORD_LOWER}${SPEED_PASSWORD_UPPER}${SPEED_PASSWORD_NUMBER}${SPEED_PASSWORD_SPECIAL}`
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pick(chars: string) {
  return chars[randomInt(0, chars.length)]
}

function shuffle(chars: string[]) {
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1)
    const current = chars[index]
    chars[index] = chars[swapIndex]
    chars[swapIndex] = current
  }
  return chars
}

export function isValidSpeedCustomConnectEmail(value?: string | null): boolean {
  const email = String(value || "").trim().toLowerCase()
  return email.length <= 320 && EMAIL_RE.test(email)
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

export function generateSpeedCustomConnectPassword(): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const chars = [
      pick(SPEED_PASSWORD_LOWER),
      pick(SPEED_PASSWORD_UPPER),
      pick(SPEED_PASSWORD_NUMBER),
      pick(SPEED_PASSWORD_SPECIAL),
    ]
    while (chars.length < 20) {
      const next = pick(SPEED_PASSWORD_ALL)
      const lastTwo = chars.slice(-2)
      if (lastTwo.length === 2 && lastTwo[0] === next && lastTwo[1] === next) continue
      chars.push(next)
    }
    const password = shuffle(chars).join("")
    if (speedCustomConnectPasswordPolicyPass(password)) return password
  }

  return `Pt9!${randomBytes(16).toString("hex").replace(/abc|123/gi, "x9")}`
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
      speedConnectedAccountId:
        existing!.speed_account_id || existing!.speed_connected_account_id,
      speedConnectedAccountRelationshipId: existing!.speed_connected_account_relationship_id,
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

  const existingAccountId = String(existing?.speed_account_id || existing?.speed_connected_account_id || "").trim()
  const existingRelationshipId = String(existing?.speed_connected_account_relationship_id || "").trim()
  if (existingAccountId || existingRelationshipId) {
    const checked = await getSpeedConnectedAccountSetupStatus({
      connectedAccountId: existingRelationshipId || null,
      accountId: existingAccountId || null,
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: checked.readiness,
      speedConnectedAccountId: checked.speed_connected_account_id || existingAccountId || null,
      speedConnectedAccountRelationshipId:
        checked.speed_connected_account_relationship_id || existingRelationshipId || null,
      speedAccountId: checked.speed_account_id || existing?.speed_account_id || null,
      speedConnectedAccountStatus: checked.speed_connected_account_status,
      speedConnectSetupUrl: checked.setup_url,
      providerResponseSummary: checked.provider_response_summary,
      providerErrorMessage: checked.error_message,
    })
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
        lightningProfile.speed_account_id || lightningProfile.speed_connected_account_id,
      speedConnectedAccountRelationshipId: lightningProfile.speed_connected_account_relationship_id,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: null,
    }
  }

  const [merchant, businessProfile] = await Promise.all([
    getMerchantById(merchantId),
    getMerchantBusinessProfile(merchantId),
  ])

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

  const merchantEmail = String(merchant?.email || "").trim().toLowerCase()
  const authEmail = String(options.authEmail || "").trim().toLowerCase()
  const speedEmail = isValidSpeedCustomConnectEmail(merchantEmail)
    ? merchantEmail
    : isValidSpeedCustomConnectEmail(authEmail)
      ? authEmail
      : null

  if (!speedEmail) {
    console.warn("[pinetree-managed-lightning] speed_connect_missing_email", {
      merchant_id: merchantId,
      merchantEmailPresent: Boolean(merchantEmail),
      authEmailPresent: Boolean(authEmail),
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_connect_missing_email",
      providerErrorMessage: "Lightning provisioning needs a valid merchant email.",
    })
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      safeReason: "missing_valid_email",
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

  const speedPassword = generateSpeedCustomConnectPassword()
  const passwordPolicyPass = speedCustomConnectPasswordPolicyPass(speedPassword)
  console.info("[pinetree-managed-lightning] speed_connect_password_generated", {
    merchant_id: merchantId,
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

  const speedAccountType = mapBusinessTypeToSpeedAccountType(businessProfile.business_type)
  if (!speedAccountType) {
    console.warn("[pinetree-managed-lightning] speed_business_type_unsupported", {
      merchant_id: merchantId,
      businessTypePresent: Boolean(businessProfile.business_type),
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_business_type_unsupported",
      providerErrorMessage: "Review your Business Profile information to finish Bitcoin setup.",
    })
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      safeReason: "business_type_unsupported",
    })
    return {
      status: lightningProfile.status,
      action: "needs_supported_business_type",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: "Review your Business Profile information to finish Bitcoin setup.",
    }
  }

  const speedPhone = normalizeUsPhoneToE164(businessProfile.owner_phone || businessProfile.business_phone)
  if (!speedPhone) {
    console.warn("[pinetree-managed-lightning] speed_phone_invalid", {
      merchant_id: merchantId,
      phonePresent: Boolean(businessProfile.owner_phone || businessProfile.business_phone),
    })
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "speed_phone_invalid",
      providerErrorMessage: "Review your Business Profile information to finish Bitcoin setup.",
    })
    await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)
    console.info("[pinetree-managed-lightning] wallet_lightning_auto_provision_skipped", {
      merchant_id: merchantId,
      status: lightningProfile.status,
      safeReason: "phone_invalid",
    })
    return {
      status: lightningProfile.status,
      action: "needs_valid_phone",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
      providerCode: null,
      fieldErrors: [],
      merchantMessage: "Review your Business Profile information to finish Bitcoin setup.",
    }
  }

  const speedBusinessName = businessProfile.business_dba || businessProfile.legal_business_name || ""
  const requestFingerprint = computeSpeedCustomConnectFingerprint({
    country: businessProfile.business_country!,
    firstName: businessProfile.owner_first_name!,
    lastName: businessProfile.owner_last_name!,
    businessName: speedBusinessName,
    email: speedEmail,
    accountType: speedAccountType,
    phone: speedPhone,
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
        country: businessProfile.business_country!,
        first_name: businessProfile.owner_first_name!,
        last_name: businessProfile.owner_last_name!,
        email: speedEmail,
        password: speedPassword,
        business_name: speedBusinessName,
        phone: speedPhone,
        account_type: speedAccountType,
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

  const status: MerchantLightningProfileStatus =
    speedSetup.readiness === "ready"
      ? "ready"
      : speedSetup.readiness === "needs_attention"
        ? "needs_attention"
        : "pending"

  // A 4xx from Speed is a deterministic validation rejection - distinguish it
  // from a generic/transient failure so the fingerprint-unchanged retry gate
  // (above) only ever suppresses retries for the case it's meant for.
  const isDeterministicRejection = Boolean(
    speedSetup.provider_http_status && speedSetup.provider_http_status >= 400 && speedSetup.provider_http_status < 500
  )
  const speedConnectedAccountStatus = status === "needs_attention" && isDeterministicRejection
    ? "speed_custom_connect_rejected"
    : speedSetup.speed_connected_account_status
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
    speedConnectedAccountId: speedSetup.speed_account_id || speedSetup.speed_connected_account_id,
    speedConnectedAccountRelationshipId: speedSetup.speed_connected_account_relationship_id,
    speedAccountId: speedSetup.speed_account_id,
    speedConnectedAccountStatus,
    speedConnectSetupUrl: speedSetup.setup_url,
    // Persist Speed's own error code, sanitized field errors, and the request
    // fingerprint alongside the existing response summary so a rejected
    // /connect/custom attempt is diagnosable from the saved row (not just the
    // request-time logs) and so the next call can tell whether the Business
    // Profile actually changed before allowing another automatic attempt.
    providerResponseSummary: {
      ...speedSetup.provider_response_summary,
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
      enabled: status === "ready",
      notes: [
        "PineTree created this Speed Custom Connect merchant account server-side.",
        "Payments use the connected account account_id, not the ca_ relationship id.",
      ],
    })
  }

  await syncLightningStatusIntoWalletProfile(merchantId, lightningProfile)

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
    speedConnectedAccountId: lightningProfile.speed_account_id || lightningProfile.speed_connected_account_id,
    speedConnectedAccountRelationshipId: lightningProfile.speed_connected_account_relationship_id,
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
