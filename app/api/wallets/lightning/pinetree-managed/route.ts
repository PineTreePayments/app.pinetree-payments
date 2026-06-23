/**
 * /api/wallets/lightning/pinetree-managed
 *
 * Manages the PineTree-owned Lightning backend profile for a merchant.
 * Merchants do not need to sign up for Speed, connect NWC, or paste any keys.
 * PineTree provisions the Speed connected account in a future pass.
 *
 * SECURITY: No Speed API keys or secrets are returned to the browser.
 */

import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getMerchantLightningProfile,
  markMerchantLightningPending,
} from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"

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
 * Creates the Lightning profile with status "pending" if it does not already exist.
 * Also syncs the lightning status into pinetree_wallet_profiles if one exists.
 *
 * No Speed sub-account creation is performed in this pass.
 * No secrets are returned to the caller.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const existing = await getMerchantLightningProfile(merchantId)

    // Only transition from not_configured → pending. Ready/needs_attention states are preserved.
    let lightningProfile = existing
    if (!existing || existing.status === "not_configured") {
      lightningProfile = await markMerchantLightningPending(merchantId)
    }

    // Sync lightning status into the wallet profile if one exists, so overall readiness
    // can be derived from a single pinetree_wallet_profiles row.
    const walletProfile = await getPineTreeWalletProfile(merchantId)
    if (walletProfile) {
      await upsertPineTreeWalletProfile({
        merchantId,
        bitcoinLightningStatus: lightningProfile!.status,
        bitcoinLightningProvider: "speed",
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
