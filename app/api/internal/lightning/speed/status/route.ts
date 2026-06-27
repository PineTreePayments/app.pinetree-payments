/**
 * GET /api/internal/lightning/speed/status
 *
 * Server-only diagnostic. Returns safe readiness booleans for the PineTree
 * Lightning / Speed integration. Never returns API keys, secrets, or raw
 * provider error messages.
 *
 * Protected by INTERNAL_API_SECRET. Optional ?merchant_id= query parameter
 * adds merchant-specific readiness fields.
 */

import { type NextRequest, NextResponse } from "next/server"
import {
  getPineTreeSpeedConfigStatus,
  getLightningProviderConfig,
} from "@/providers/lightning/speedClient"
import { getSpeedLightningCapabilities } from "@/providers/speed/speedLightningSettlement"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { getActiveMerchantPayoutDestination, listMerchantPayoutDestinations } from "@/database/merchantPayoutDestinations"
import { getLightningSettlementSettings } from "@/database/lightningSettlementSettings"

function isAuthorized(req: NextRequest): boolean {
  const secret =
    String(process.env.INTERNAL_API_SECRET || "").trim() ||
    String(process.env.CRON_SECRET || "").trim()
  if (!secret) return false
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return bearer === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const merchantId = searchParams.get("merchant_id") || null

  const speedConfig = getPineTreeSpeedConfigStatus()
  const providerConfig = getLightningProviderConfig()
  const capabilities = getSpeedLightningCapabilities()

  const platformStatus = {
    speedConfigured: speedConfig.configured,
    connectConfigured: Boolean(
      String(process.env.SPEED_CONNECT_ENABLED || "").trim().toLowerCase() === "true"
    ),
    canCreateMerchantAccounts: capabilities.connectAvailable,
    canCreateInvoices: speedConfig.configured,
    canSetPayoutDestination: true,
    settlementMode: providerConfig.settlementMode || null,
    missingConfigKeys: speedConfig.missing,
  }

  if (!merchantId) {
    return NextResponse.json(platformStatus)
  }

  try {
    const [lightningProfile, destinations, settlementSettings] = await Promise.all([
      getMerchantLightningProfile(merchantId),
      listMerchantPayoutDestinations(merchantId, { rail: "bitcoin_lightning", asset: "BTC" }),
      getLightningSettlementSettings(merchantId).catch(() => null),
    ])

    const activeDestination = settlementSettings?.payout_destination_id
      ? await getActiveMerchantPayoutDestination(merchantId, settlementSettings.payout_destination_id).catch(() => null)
      : destinations.find((d) => d.status === "active") || null

    const merchantHasSpeedReference = Boolean(lightningProfile?.speed_connected_account_id)
    const merchantHasPayoutDestination = Boolean(activeDestination?.destination_address)
    const merchantLightningReady =
      platformStatus.speedConfigured &&
      merchantHasPayoutDestination &&
      (providerConfig.speedPlatformTreasurySweepEnabled || merchantHasSpeedReference)

    return NextResponse.json({
      ...platformStatus,
      merchantHasSpeedReference,
      merchantHasPayoutDestination,
      merchantLightningReady,
      merchantLightningProfileStatus: lightningProfile?.status ?? null,
      payoutDestinationType: activeDestination?.destination_type ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Merchant readiness check failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
