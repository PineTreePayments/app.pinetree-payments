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
  upsertMerchantLightningProfile,
  type MerchantLightningProfileStatus,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  createOrLinkSpeedConnectedAccountForMerchant,
  type SpeedConnectedAccountReadiness,
} from "@/providers/lightning/speedConnectedAccounts"

function mapSpeedReadinessToLightningStatus(
  readiness: SpeedConnectedAccountReadiness
): MerchantLightningProfileStatus {
  if (readiness === "ready") return "ready"
  if (readiness === "needs_attention") return "needs_attention"
  return "pending"
}

/**
 * GET /api/wallets/lightning/pinetree-managed
 * Returns the current merchant's PineTree-managed Lightning profile, or { profile: null } if none.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const profile = await getMerchantLightningProfile(merchantId)
    return NextResponse.json({ profile })
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

    const merchant = await getMerchantById(merchantId)

    const speedSetup = await createOrLinkSpeedConnectedAccountForMerchant({
      merchant_id: merchantId,
      business_name: merchant?.business_name ?? null,
      merchant_email: merchant?.email ?? null,
      pinetree_reference_id: `pinetree-merchant:${merchantId}`,
    })

    const nextStatus = mapSpeedReadinessToLightningStatus(speedSetup.readiness)

    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status: nextStatus,
      speedConnectedAccountId: speedSetup.speed_connected_account_id,
      speedConnectedAccountStatus: speedSetup.speed_connected_account_status,
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

    return NextResponse.json({ profile: lightningProfile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to enable Lightning" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
