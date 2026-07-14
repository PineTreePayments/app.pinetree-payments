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
import { requireMerchantAuthFromRequest, requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getMerchantLightningProfile,
  type MerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { hasProcessableLightningSweepForMerchant } from "@/database/merchantLightningSweeps"
import { scheduleLightningSweepProcessing } from "@/lib/api/lightningSweepMaintenance"
import { ensureManagedLightningForMerchant } from "@/engine/pineTreeWalletReadiness"
import { withOperationTimeout, OperationTimeoutError } from "@/engine/promiseTimeout"
import {
  getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE
} from "@/providers/lightning/speedClient"

const LIGHTNING_PROVISIONING_TIMEOUT_MS = 12_000

function safeProvisioningLogMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  if (!message) return "unknown"
  return message
    .replace(/sk_(test|live)_[A-Za-z0-9_-]+/g, "sk_$1_[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 240)
}

function safeLightningProfile(profile: MerchantLightningProfile | null) {
  if (!profile) return null
  return {
    id: profile.id,
    merchant_id: profile.merchant_id,
    status: profile.status,
    receive_mode: profile.receive_mode,
    setup_source: profile.setup_source,
    last_checked_at: profile.last_checked_at,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  }
}

function normalizedLightningRail(profile: MerchantLightningProfile | null) {
  const accountId = String(profile?.speed_account_id || "").trim()
  const providerStatus = String(profile?.speed_connected_account_status || "").trim().toLowerCase()
  const connected = accountId.startsWith("acct_") && providerStatus === "active"
  return {
    rail: "bitcoin" as const,
    display_name: "Bitcoin" as const,
    status: profile?.status || "pending",
    connected,
    withdrawal_available: false,
    balance: {
      asset: "BTC" as const,
      amount: null,
      usd_value: null,
      status: connected ? "unavailable" as const : "pending_sync" as const,
    },
    message: profile?.provider_error_message || null,
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

      const syntheticProfile = {
          id: profile?.id || `pinetree-wallet:${merchantId}:lightning`,
          merchant_id: merchantId,
          status,
          receive_mode: "invoice",
          setup_source: "pinetree_managed",
          settlement_mode: SPEED_PLATFORM_TREASURY_SWEEP_MODE,
          btc_address_present: Boolean(profile?.btc_address),
          btc_payout_enabled: Boolean(profile?.btc_payout_enabled),
          last_checked_at: new Date().toISOString(),
          created_at: profile?.created_at || null,
          updated_at: profile?.updated_at || null,
        }
      return NextResponse.json({
        profile: syntheticProfile,
        rail: normalizedLightningRail(null),
        setup_status: status,
        status,
      })
    }

    const profile = await getMerchantLightningProfile(merchantId)

    // Bounded, best-effort: only schedules a processing pass (via after(),
    // never blocking this response) when this merchant actually has a
    // sweep due for another attempt. No client-side polling anywhere drives
    // this - it only ever fires from a page load or focus refetch the
    // merchant already triggered themselves.
    if (await hasProcessableLightningSweepForMerchant(merchantId)) {
      scheduleLightningSweepProcessing("wallet_page_load", { limit: 2 })
    }

    return NextResponse.json({
      profile: safeLightningProfile(profile),
      rail: normalizedLightningRail(profile),
      setup_status: profile?.status || "pending",
      status: profile?.status || "pending",
    })
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
    const auth = await requireMerchantAuthFromRequest(req)
    const merchantId = auth.merchantId
    // Explicit, merchant-initiated retry only - never set by the automatic
    // on-open provisioning call. Bypasses the deterministic-rejection /
    // unchanged-profile retry gate for exactly this one attempt.
    const forceRetry = req.nextUrl.searchParams.get("retry") === "true"
    console.info("[pinetree-managed-lightning] POST start", { merchant_id: merchantId, forceRetry })
    const ensureStartedAt = Date.now()

    let ensureResult: Awaited<ReturnType<typeof ensureManagedLightningForMerchant>> | null = null
    try {
      ensureResult = await withOperationTimeout(
        ensureManagedLightningForMerchant(merchantId, { authEmail: auth.email, forceRetry }),
        LIGHTNING_PROVISIONING_TIMEOUT_MS,
        "managed lightning provisioning"
      )

      console.info("[pinetree-managed-lightning] ensure result", {
        merchant_id: merchantId,
        action: ensureResult.action,
        status: ensureResult.status,
        connected_account_id_present: Boolean(ensureResult.speedConnectedAccountId),
      })
      console.info("[pinetree-managed-lightning] ensure timing", {
        merchant_id: merchantId,
        step: "lightning_ensure_complete",
        duration_ms: Date.now() - ensureStartedAt,
      })
    } catch (error) {
      console.warn("[pinetree-managed-lightning] provisioning_deferred", {
        merchant_id: merchantId,
        error: safeProvisioningLogMessage(error),
      })
      console.info("[pinetree-managed-lightning] ensure timing", {
        merchant_id: merchantId,
        step: "lightning_ensure_deferred",
        duration_ms: Date.now() - ensureStartedAt,
      })
      if (error instanceof OperationTimeoutError) {
        console.warn("[pinetree-managed-lightning] wallet_lightning_auto_provision_timeout", {
          merchant_id: merchantId,
          elapsed_ms: Date.now() - ensureStartedAt,
        })
      } else {
        console.warn("[pinetree-managed-lightning] wallet_lightning_auto_provision_failed", {
          merchant_id: merchantId,
          elapsed_ms: Date.now() - ensureStartedAt,
        })
      }
      const profile = await getMerchantLightningProfile(merchantId).catch(() => null)
      const isTimeout = error instanceof OperationTimeoutError
      const retryableStatus = isTimeout
        ? "incomplete"
        : profile?.status === "needs_attention"
          ? "failed"
          : "failed"
      return NextResponse.json({
        profile: safeLightningProfile(profile),
        rail: normalizedLightningRail(profile),
        setup_status: retryableStatus,
        status: retryableStatus,
        providerCode: null,
        fieldErrors: [],
        merchantMessage: null,
        message: isTimeout
          ? "Wallet setup is still processing. Please try again shortly."
          : "Bitcoin setup could not be completed. Please retry after review.",
      }, { status: isTimeout ? 202 : 500 })
    }

    const profile = await getMerchantLightningProfile(merchantId)
    const responseStatus =
      profile?.status === "needs_attention" && ensureResult?.providerCode ? 422 : 200
    return NextResponse.json({
      profile: safeLightningProfile(profile),
      rail: normalizedLightningRail(profile),
      setup_status: profile?.status || "pending",
      // Structured outcome for the calling client - status mirrors setup_status;
      // providerCode/fieldErrors surface Speed's own /connect/custom validation
      // failure (e.g. HTTP 400) instead of a generic "needs_attention".
      status: profile?.status || "pending",
      providerCode: ensureResult?.providerCode ?? null,
      fieldErrors: ensureResult?.fieldErrors ?? [],
      // Canned, merchant-safe copy only - never Speed's raw provider message.
      merchantMessage: ensureResult?.merchantMessage ?? null,
    }, { status: responseStatus })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to enable Lightning" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
