/**
 * POST /api/internal/wallets/pinetree/btc-address
 *
 * Admin/internal-only route to set the PineTree Bitcoin wallet address for a
 * merchant. Used when Dynamic/Fireblocks BTC provisioning is not yet available
 * so Speed Lightning payout testing can continue without blocking on Dynamic.
 *
 * Protected by INTERNAL_API_SECRET — never merchant-facing.
 * Body: { merchant_id, btc_address, btc_wallet_provider?, btc_address_type? }
 */

import { type NextRequest, NextResponse } from "next/server"
import {
  upsertPineTreeWalletProfile,
  inferBtcAddressType,
  normalizeBtcAddressType,
} from "@/database/pineTreeWalletProfiles"

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.INTERNAL_API_SECRET || "").trim()
  if (!secret) return false
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return bearer === secret
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const merchantId = String(body.merchant_id || "").trim()
  if (!merchantId) {
    return NextResponse.json({ error: "merchant_id is required" }, { status: 400 })
  }

  const rawAddress = String(body.btc_address || "").trim()
  if (!rawAddress) {
    return NextResponse.json({ error: "btc_address is required" }, { status: 400 })
  }

  const btcWalletProvider = String(body.btc_wallet_provider || "manual_internal").trim()

  // Determine address type: explicit override > inferred from address prefix
  const explicitType =
    "btc_address_type" in body ? normalizeBtcAddressType(body.btc_address_type as string) : null
  const btcAddressType = explicitType && explicitType !== "unknown"
    ? explicitType
    : inferBtcAddressType(rawAddress)

  try {
    const profile = await upsertPineTreeWalletProfile({
      merchantId,
      btcAddress: rawAddress,
      btcAddressType,
      btcWalletProvider,
      btcPayoutEnabled: true,
      btcPayoutVerifiedAt: new Date().toISOString(),
    })

    return NextResponse.json({
      ok: true,
      merchant_id: merchantId,
      btc_address: profile.btc_address,
      btc_address_type: profile.btc_address_type,
      btc_wallet_provider: profile.btc_wallet_provider,
      btc_payout_enabled: profile.btc_payout_enabled,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set BTC address" },
      { status: 500 }
    )
  }
}
