/**
 * /api/wallets/lightning/pinetree-managed
 *
 * Manages the PineTree-owned Lightning backend profile for a merchant.
 * Merchants do not need to sign up for Speed, connect NWC, or paste any keys.
 * Canonical treasury-sweep mode uses PineTree's Speed account and the merchant's
 * PineTree Bitcoin wallet payout address.
 *
 * SECURITY: No Speed API keys or secrets are returned to the browser.
 */

import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getMerchantById } from "@/database/merchants"
import {
  getMerchantLightningProfile,
  type MerchantLightningProfile,
  upsertMerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  createOrLinkSpeedConnectedAccountForMerchant,
  type CreateOrLinkSpeedConnectedAccountResult,
  type SpeedConnectedAccountReadiness,
} from "@/providers/lightning/speedConnectedAccounts"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE
} from "@/providers/lightning/speedClient"

function mapSpeedReadinessToLightningStatus(
  readiness: SpeedConnectedAccountReadiness
): MerchantLightningProfileStatus {
  if (readiness === "ready") return "ready"
  if (readiness === "needs_attention") return "needs_attention"
  return "pending"
}

function safeLightningProfile(profile: MerchantLightningProfile | null) {
  if (!profile) return null
  return {
    id: profile.id,
    merchant_id: profile.merchant_id,
    provider: profile.provider,
    status: profile.status,
    speed_connected_account_id: profile.speed_connected_account_id,
    speed_connected_account_status: profile.speed_connected_account_status,
    setup_url: profile.speed_connect_setup_url,
    receive_mode: profile.receive_mode,
    setup_source: profile.setup_source,
    last_checked_at: profile.last_checked_at,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  }
}

function safeProviderErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return (message || "Speed Connect provisioning failed before a provider response was saved.")
    .replace(/sk_(test|live)_[A-Za-z0-9_-]+/g, "sk_$1_[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .slice(0, 500)
}

function getSafeSpeedConnectLogContext(merchantId: string) {
  const config = getPineTreeSpeedConfigStatus()
  return {
    merchant_id: merchantId,
    SPEED_CONNECT_ENABLED: String(process.env.SPEED_CONNECT_ENABLED || ""),
    SPEED_API_KEY_present: Boolean(String(process.env.SPEED_API_KEY || "").trim()),
    SPEED_API_BASE_URL: config.apiBaseUrl,
    SPEED_CONNECT_RETURN_URL_present: Boolean(
      String(process.env.SPEED_CONNECT_RETURN_URL || "").trim()
    ),
  }
}

function getSafeTreasurySweepLogContext(merchantId: string) {
  const config = getPineTreeSpeedConfigStatus()
  return {
    merchant_id: merchantId,
    lightning_provider: process.env.PINE_TREE_LIGHTNING_PROVIDER || "",
    settlement_mode: process.env.PINE_TREE_LIGHTNING_SETTLEMENT_MODE || "",
    SPEED_API_KEY_present: Boolean(String(process.env.SPEED_API_KEY || "").trim()),
    SPEED_WEBHOOK_SECRET_present: Boolean(String(process.env.SPEED_WEBHOOK_SECRET || "").trim()),
    SPEED_API_BASE_URL: config.apiBaseUrl,
  }
}

function failedSpeedSetupResult(error: unknown): CreateOrLinkSpeedConnectedAccountResult {
  const config = getPineTreeSpeedConfigStatus()
  return {
    status: "needs_attention",
    speed_connected_account_id: null,
    speed_connected_account_status: "speed_connect_helper_failed",
    setup_url: null,
    provider_response_summary: {
      connected_account_id: null,
      account_id: null,
      account_name: null,
      owner_email_present: false,
      status: "speed_connect_helper_failed",
      type: null,
      setup_url_present: false,
      source: "error",
    },
    error_message: safeProviderErrorMessage(error),
    raw_provider_status: "speed_connect_helper_failed",
    readiness: "needs_attention",
    mode: config.mode,
    used_live_api: false,
  }
}

/**
 * GET /api/wallets/lightning/pinetree-managed
 * Returns the current merchant's PineTree-managed Lightning profile, or { profile: null } if none.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    if (isSpeedPlatformTreasurySweepEnabled()) {
      const profile = await getPineTreeWalletProfile(merchantId)
      const speedConfig = getPineTreeSpeedConfigStatus()
      const btcAddressReady = Boolean(profile?.btc_address && profile.btc_payout_enabled)
      const status: MerchantLightningProfileStatus = speedConfig.configured && btcAddressReady
        ? "ready"
        : speedConfig.configured
          ? "pending"
          : "needs_attention"

      return NextResponse.json({
        profile: {
          id: profile?.id || `pinetree-wallet:${merchantId}:lightning`,
          merchant_id: merchantId,
          provider: "speed",
          status,
          speed_connected_account_id: null,
          speed_connected_account_status: null,
          setup_url: null,
          receive_mode: "invoice",
          setup_source: "pinetree_managed",
          settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
          btc_address_present: Boolean(profile?.btc_address),
          btc_payout_enabled: Boolean(profile?.btc_payout_enabled),
          last_checked_at: new Date().toISOString(),
          created_at: profile?.created_at || null,
          updated_at: profile?.updated_at || null,
        }
      })
    }

    const profile = await getMerchantLightningProfile(merchantId)
    return NextResponse.json({ profile: safeLightningProfile(profile) })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load Lightning profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

/**
 * POST /api/wallets/lightning/pinetree-managed
 * Enables the PineTree-managed Lightning rail for the merchant.
 * Creates or links the merchant's Speed connected account when the live Speed
 * Connect API is available. Otherwise keeps the profile safely pending.
 * Also syncs the lightning status into pinetree_wallet_profiles if one exists.
 *
 * No secrets are returned to the caller.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    if (isSpeedPlatformTreasurySweepEnabled()) {
      const logContext = getSafeTreasurySweepLogContext(merchantId)
      console.info("[pinetree-managed-lightning] treasury_sweep_post_start", logContext)

      const speedConfig = getPineTreeSpeedConfigStatus()
      const walletProfile = await getPineTreeWalletProfile(merchantId)
      const btcAddressReady = Boolean(walletProfile?.btc_address && walletProfile.btc_payout_enabled)
      const nextStatus: MerchantLightningProfileStatus = speedConfig.configured && btcAddressReady
        ? "ready"
        : speedConfig.configured
          ? "pending"
          : "needs_attention"

      const lightningProfile = await upsertMerchantLightningProfile({
        merchantId,
        status: nextStatus,
        speedConnectedAccountId: null,
        speedConnectedAccountStatus: speedConfig.configured
          ? btcAddressReady ? "pinetree_wallet_btc_payout_ready" : "btc_payout_address_pending"
          : "speed_platform_config_missing",
        speedConnectSetupUrl: null,
        providerResponseSummary: {
          source: "speed_platform_treasury_sweep",
          settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
          speed_configured: speedConfig.configured,
          speed_missing: speedConfig.missing,
          btc_address_present: Boolean(walletProfile?.btc_address),
          btc_payout_enabled: Boolean(walletProfile?.btc_payout_enabled),
        },
        providerErrorMessage: speedConfig.configured
          ? btcAddressReady ? null : "Bitcoin address pending for PineTree Wallet."
          : `PineTree Speed platform missing: ${speedConfig.missing.join(", ")}`,
      })

      if (walletProfile) {
        await upsertPineTreeWalletProfile({
          merchantId,
          bitcoinLightningStatus: nextStatus,
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

      return NextResponse.json({ profile: safeLightningProfile(lightningProfile) })
    }

    const logContext = getSafeSpeedConnectLogContext(merchantId)
    console.info("[pinetree-managed-lightning] POST start", logContext)

    const merchant = await getMerchantById(merchantId)

    let speedSetup: CreateOrLinkSpeedConnectedAccountResult
    try {
      speedSetup = await createOrLinkSpeedConnectedAccountForMerchant({
        merchant_id: merchantId,
        business_name: merchant?.business_name ?? null,
        merchant_email: merchant?.email ?? null,
        pinetree_reference_id: `pinetree-merchant:${merchantId}`,
      })
    } catch (error) {
      speedSetup = failedSpeedSetupResult(error)
    }

    console.info("[pinetree-managed-lightning] helper result", {
      merchant_id: merchantId,
      helper_result_status: speedSetup.readiness,
      setup_url_returned: Boolean(speedSetup.setup_url),
      connected_account_id_returned: Boolean(speedSetup.speed_connected_account_id),
    })

    const nextStatus = mapSpeedReadinessToLightningStatus(speedSetup.readiness)

    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: nextStatus,
      speedConnectedAccountId: speedSetup.speed_connected_account_id,
      speedConnectedAccountStatus: speedSetup.speed_connected_account_status,
      speedConnectSetupUrl: speedSetup.setup_url,
      providerResponseSummary: speedSetup.provider_response_summary,
      providerErrorMessage: speedSetup.error_message,
    })

    console.info("[pinetree-managed-lightning] profile saved", {
      merchant_id: merchantId,
      final_saved_profile_status: lightningProfile.status,
    })

    // Sync lightning status into the wallet profile if one exists, so overall readiness
    // can be derived from a single pinetree_wallet_profiles row.
    const walletProfile = await getPineTreeWalletProfile(merchantId)
    if (walletProfile) {
      await upsertPineTreeWalletProfile({
        merchantId,
        bitcoinLightningStatus: lightningProfile.status,
        bitcoinLightningProvider: "speed",
        bitcoinLightningAccountId: lightningProfile.speed_connected_account_id,
        bitcoinLightningReceiveMode: "invoice",
      })
    }

    return NextResponse.json({ profile: safeLightningProfile(lightningProfile) })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to enable Lightning" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
