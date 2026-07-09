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
import {
  getMerchantLightningProfile,
  type MerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { ensureManagedLightningForMerchant } from "@/engine/pineTreeWalletReadiness"
import { withOperationTimeout } from "@/engine/promiseTimeout"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE
} from "@/providers/lightning/speedClient"

const LIGHTNING_PROVISIONING_TIMEOUT_MS = 12_000

function safeLightningProfile(profile: MerchantLightningProfile | null) {
  if (!profile) return null
  return {
    id: profile.id,
    merchant_id: profile.merchant_id,
    provider: profile.provider,
    status: profile.status,
    speed_connected_account_id: profile.speed_connected_account_id,
    speed_connected_account_relationship_id: profile.speed_connected_account_relationship_id,
    speed_account_id: profile.speed_account_id,
    speed_connected_account_status: profile.speed_connected_account_status,
    setup_url: profile.speed_connect_setup_url,
    receive_mode: profile.receive_mode,
    setup_source: profile.setup_source,
    last_checked_at: profile.last_checked_at,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
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
      const btcReady = Boolean(profile?.btc_address && profile.btc_payout_enabled)
      const status: MerchantLightningProfileStatus = !speedConfig.configured
        ? "needs_attention"
        : !btcReady
          ? "pending"
          : "ready"

      return NextResponse.json({
        profile: {
          id: profile?.id || `pinetree-wallet:${merchantId}:lightning`,
          merchant_id: merchantId,
          provider: "speed",
          status,
          speed_connected_account_id: null,
          speed_connected_account_relationship_id: null,
          speed_account_id: null,
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
 * Ensures the PineTree-managed Lightning rail for the merchant: provisions a
 * Speed Custom Connect connected account server-side (no Speed signup link,
 * no OAuth redirect), or no-ops if one is already active. Also syncs the
 * lightning status into pinetree_wallet_profiles if one exists.
 *
 * No secrets are returned to the caller.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    console.info("[pinetree-managed-lightning] POST start", { merchant_id: merchantId })
    const ensureStartedAt = Date.now()

    try {
      const result = await withOperationTimeout(
        ensureManagedLightningForMerchant(merchantId),
        LIGHTNING_PROVISIONING_TIMEOUT_MS,
        "managed lightning provisioning"
      )

      console.info("[pinetree-managed-lightning] ensure result", {
        merchant_id: merchantId,
        action: result.action,
        status: result.status,
        connected_account_id_present: Boolean(result.speedConnectedAccountId),
      })
      console.info("[pinetree-managed-lightning] ensure timing", {
        merchant_id: merchantId,
        step: "lightning_ensure_complete",
        duration_ms: Date.now() - ensureStartedAt,
      })
    } catch (error) {
      console.warn("[pinetree-managed-lightning] provisioning_deferred", {
        merchant_id: merchantId,
        error: error instanceof Error ? error.message : String(error),
      })
      console.info("[pinetree-managed-lightning] ensure timing", {
        merchant_id: merchantId,
        step: "lightning_ensure_deferred",
        duration_ms: Date.now() - ensureStartedAt,
      })
      const profile = await getMerchantLightningProfile(merchantId).catch(() => null)
      return NextResponse.json({
        profile: safeLightningProfile(profile),
        setup_status: profile?.status === "needs_attention" ? "needs_attention" : "retryable",
        message: "Wallet setup is still processing. Please try again shortly.",
      })
    }

    const profile = await getMerchantLightningProfile(merchantId)
    return NextResponse.json({
      profile: safeLightningProfile(profile),
      setup_status: profile?.status || "pending",
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to enable Lightning" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
