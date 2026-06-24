import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { syncPineTreeWalletRailsEngine } from "@/engine/pineTreeWalletRailSync"

/**
 * POST /api/wallets/pinetree-wallet/rail-sync
 * Syncs the merchant's PineTree Wallet addresses (base_address, solana_address)
 * into merchant_wallets and merchant_providers so payment routing works.
 * Idempotent — safe to call on every wallet page load.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await syncPineTreeWalletRailsEngine(merchantId)
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json(
      { error: "Rail sync failed" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
