import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"

/**
 * GET /api/wallets/pinetree-profile
 * Returns the current merchant's PineTree Wallet profile, or { profile: null } if none exists.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const profile = await getPineTreeWalletProfile(merchantId)
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load wallet profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

/**
 * POST /api/wallets/pinetree-profile
 * Creates or updates the PineTree Wallet profile for the authenticated merchant.
 * Only the addresses/dynamic_user_id provided in the body are written; omitted fields keep their value.
 *
 * Body (all optional):
 *   dynamic_user_id        string | null
 *   base_address           string | null
 *   solana_address         string | null
 *   bitcoin_lightning_address  string | null
 *   bitcoin_onchain_address    string | null
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>

    const profile = await upsertPineTreeWalletProfile({
      merchantId,
      dynamicUserId: "dynamic_user_id" in body ? (body.dynamic_user_id as string | null) : undefined,
      baseAddress: "base_address" in body ? (body.base_address as string | null) : undefined,
      solanaAddress: "solana_address" in body ? (body.solana_address as string | null) : undefined,
      bitcoinLightningAddress: "bitcoin_lightning_address" in body ? (body.bitcoin_lightning_address as string | null) : undefined,
      bitcoinOnchainAddress: "bitcoin_onchain_address" in body ? (body.bitcoin_onchain_address as string | null) : undefined,
      bitcoinLightningStatus: "bitcoin_lightning_status" in body ? (body.bitcoin_lightning_status as "not_configured" | "pending" | "ready" | "needs_attention" | undefined) : undefined,
      bitcoinLightningProvider: "bitcoin_lightning_provider" in body ? (body.bitcoin_lightning_provider as string | null) : undefined,
      bitcoinLightningAccountId: "bitcoin_lightning_account_id" in body ? (body.bitcoin_lightning_account_id as string | null) : undefined,
    })

    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save wallet profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
