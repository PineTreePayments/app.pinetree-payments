import { type NextRequest, NextResponse } from "next/server"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.INTERNAL_API_SECRET || "").trim()
  if (!secret) return false
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return bearer === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const merchantId = req.nextUrl.searchParams.get("merchant_id")?.trim()
  if (!merchantId) {
    return NextResponse.json({ error: "merchant_id is required" }, { status: 400 })
  }

  const profile = await getPineTreeWalletProfile(merchantId)

  return NextResponse.json({
    profile_exists: Boolean(profile),
    base_address_present: Boolean(profile?.base_address),
    solana_address_present: Boolean(profile?.solana_address),
    btc_address_present: Boolean(profile?.btc_address),
    btc_wallet_provider: profile?.btc_wallet_provider || null,
    btc_wallet_provisioning_status: profile?.btc_wallet_provisioning_status || null,
    btc_wallet_provisioning_error: profile?.btc_wallet_provisioning_error || null,
    updated_at: profile?.updated_at || null,
  })
}

