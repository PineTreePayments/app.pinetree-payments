/**
 * /api/wallets/lightning/pinetree-managed
 *
 * Manages the PineTree-owned Lightning backend profile for a merchant.
 * Merchants do not need to sign up for Speed, connect NWC, or paste any keys.
 * PineTree provisions or links the Speed connected account server-side.
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
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"

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
