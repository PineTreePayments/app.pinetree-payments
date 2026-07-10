import { type NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { getPineTreeDynamicAuthConfig } from "@/lib/pinetreeDynamicAuth"

/**
 * GET /api/debug/pinetree-wallet/smoke
 *
 * Admin-only smoke check for the PineTree Wallet setup flow. Reports coarse,
 * enum-shaped state only - it exists so an operator can confirm "does this
 * merchant have a profile, what status is it in, and which Dynamic auth mode
 * is the client built with" without touching the database directly.
 *
 * Never returns emails, wallet addresses, Dynamic user IDs, JWTs, Speed
 * payloads, or any secret - only booleans and status enums.
 */

function smokeEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PINETREE_WALLET_DEBUG_SMOKE_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_WALLET_DEBUG_EVENTS === "true"
  )
}

export async function GET(req: NextRequest) {
  try {
    if (!smokeEnabled()) {
      return NextResponse.json({ error: "Wallet setup smoke check is disabled" }, { status: 404 })
    }

    const adminId = await requireAdminFromRequest(req)
    const merchantIdParam = req.nextUrl.searchParams.get("merchant_id")
    const merchantId = merchantIdParam && merchantIdParam.trim() ? merchantIdParam.trim() : adminId

    const [profile, lightningProfile] = await Promise.all([
      getPineTreeWalletProfile(merchantId),
      getMerchantLightningProfile(merchantId),
    ])
    const authConfig = getPineTreeDynamicAuthConfig()

    // Coarse presence/status values only - deliberately no emails, addresses,
    // Dynamic IDs, or provider payloads.
    return NextResponse.json({
      profileExists: Boolean(profile),
      profileStatus: profile?.status ?? null,
      profileHasBaseAddress: Boolean(profile?.base_address),
      profileHasSolanaAddress: Boolean(profile?.solana_address),
      lightningStatus: lightningProfile?.status ?? null,
      dynamicAuthMode: authConfig.mode,
      externalJwtEnabled: authConfig.externalJwtConfigured,
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to run PineTree Wallet smoke check" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
