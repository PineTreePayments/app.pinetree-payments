/**
 * PineTree Wallet -> Lightning readiness.
 *
 * PineTree Wallet is the canonical setup surface for Bitcoin Lightning.
 * ensureManagedLightningForMerchant is the single entry point that keeps a
 * merchant's Speed Custom Connect connected account provisioned server-side —
 * merchants never see a Speed signup/OAuth flow.
 */

import { randomBytes } from "node:crypto"
import { getMerchantById, getMerchantBusinessOwnerProfile } from "@/database/merchants"
import {
  getMerchantLightningProfile,
  upsertMerchantLightningProfile,
  type MerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { saveMerchantSpeedConnection } from "@/database/merchantProviders"
import { createSpeedCustomConnectedAccountForMerchant } from "@/providers/lightning/speedConnectedAccounts"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE,
} from "@/providers/lightning/speedClient"

export type EnsureManagedLightningAction =
  | "already_active"
  | "provisioned"
  | "provisioning_incomplete"
  | "needs_business_owner_profile"
  | "treasury_sweep_mode"

export type EnsureManagedLightningResult = {
  status: MerchantLightningProfileStatus
  action: EnsureManagedLightningAction
  speedConnectedAccountId: string | null
  speedConnectedAccountRelationshipId: string | null
  speedConnectedAccountStatus: string | null
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
function generateSpeedCustomConnectPassword(): string {
  return randomBytes(24).toString("base64url")
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
 *  - If the merchant hasn't saved their business-owner profile (first/last
 *    name, country) yet: marks the profile needs_attention and returns
 *    without calling Speed — there is nothing to submit yet.
 *  - Otherwise: calls the existing Speed Custom Connect helper and persists
 *    both the ca_ relationship id and the acct_ connected account id.
 *
 * Cheap to call on every PineTree Wallet open: the common case (already
 * active) short-circuits on a single DB read before any Speed API call.
 */
export async function ensureManagedLightningForMerchant(
  merchantId: string
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

  const merchant = await getMerchantById(merchantId)
  const businessOwnerProfile = getMerchantBusinessOwnerProfile(merchant)

  if (!businessOwnerProfile) {
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: "needs_attention",
      speedConnectedAccountStatus: "business_owner_profile_required",
      providerErrorMessage:
        "Save the business owner's first name, last name, and country to enable Bitcoin Lightning.",
    })
    return {
      status: lightningProfile.status,
      action: "needs_business_owner_profile",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: lightningProfile.speed_connected_account_status,
    }
  }

  const speedSetup = await createSpeedCustomConnectedAccountForMerchant({
    merchant_id: merchantId,
    country: businessOwnerProfile.businessCountry,
    first_name: businessOwnerProfile.ownerFirstName,
    last_name: businessOwnerProfile.ownerLastName,
    email: String(merchant?.email || "").trim(),
    password: generateSpeedCustomConnectPassword(),
  })

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
