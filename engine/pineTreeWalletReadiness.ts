/**
 * PineTree Wallet -> Lightning readiness.
 *
 * PineTree Wallet is the canonical setup surface for Bitcoin Lightning.
 * ensureManagedLightningForMerchant is the single entry point that keeps a
 * merchant's Speed Custom Connect connected account provisioned server-side —
 * merchants never see a Speed signup/OAuth flow.
 */

import { randomBytes, randomInt } from "node:crypto"
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
import { withOperationTimeout } from "@/engine/promiseTimeout"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE,
} from "@/providers/lightning/speedClient"

export type EnsureManagedLightningAction =
  | "already_active"
  | "existing_account_checked"
  | "provisioned"
  | "provisioning_incomplete"
  | "needs_business_profile"
  | "needs_business_owner_profile"
  | "treasury_sweep_mode"

export type EnsureManagedLightningResult = {
  status: MerchantLightningProfileStatus
  action: EnsureManagedLightningAction
  speedConnectedAccountId: string | null
  speedConnectedAccountRelationshipId: string | null
  speedConnectedAccountStatus: string | null
}

export type EnsureManagedLightningOptions = {
  authEmail?: string | null
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
export async function ensureManagedLightningForMerchant(
  merchantId: string,
  options: EnsureManagedLightningOptions = {}
): Promise<EnsureManagedLightningResult> {
  const existing = await getMerchantLightningProfile(merchantId)

  if (isActiveLightningProfile(existing)) {
    return {
      status: "ready",
      action: "already_active",
      speedConnectedAccountId:
        existing!.speed_account_id || existing!.speed_connected_account_id,
      speedConnectedAccountRelationshipId: existing!.speed_connected_account_relationship_id,
      speedConnectedAccountStatus: existing!.speed_connected_account_status,
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
    return {
      status: lightningProfile.status,
      action: "existing_account_checked",
      speedConnectedAccountId:
        lightningProfile.speed_account_id || lightningProfile.speed_connected_account_id,
      speedConnectedAccountRelationshipId: lightningProfile.speed_connected_account_relationship_id,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
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
    return {
      status: lightningProfile.status,
      action: "needs_business_owner_profile",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
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
    return {
      status: lightningProfile.status,
      action: "provisioning_incomplete",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
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
    return {
      status: lightningProfile.status,
      action: "provisioning_incomplete",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
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
    return {
      status: lightningProfile.status,
      action: "provisioning_incomplete",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
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

  const lightningProfile = await upsertMerchantLightningProfile({
    merchantId,
    status,
    speedConnectedAccountId: speedSetup.speed_account_id || speedSetup.speed_connected_account_id,
    speedConnectedAccountRelationshipId: speedSetup.speed_connected_account_relationship_id,
    speedAccountId: speedSetup.speed_account_id,
    speedConnectedAccountStatus: speedSetup.speed_connected_account_status,
    speedConnectSetupUrl: speedSetup.setup_url,
    providerResponseSummary: speedSetup.provider_response_summary,
    providerErrorMessage: speedSetup.error_message,
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

  return {
    status: lightningProfile.status,
    action: status === "ready" ? "provisioned" : "provisioning_incomplete",
    speedConnectedAccountId: lightningProfile.speed_account_id || lightningProfile.speed_connected_account_id,
    speedConnectedAccountRelationshipId: lightningProfile.speed_connected_account_relationship_id,
    speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
  }
}
