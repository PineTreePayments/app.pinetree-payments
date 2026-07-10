import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { RailSyncEngineError, syncPineTreeWalletRailsEngine } from "@/engine/pineTreeWalletRailSync"

/**
 * POST /api/wallets/pinetree-wallet/rail-sync
 * Syncs the merchant's PineTree Wallet addresses (base_address, solana_address)
 * into merchant_wallets and merchant_providers so payment routing works.
 * Idempotent — safe to call on every wallet page load.
 *
 * A ready Base/Solana profile always returns 200, even when Lightning is
 * unavailable or the rail-sync dedup table is temporarily unreadable - both are
 * non-fatal inside the engine. Only a genuine unexpected/database failure
 * returns { ok: false, stage, code } with a real error status.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await syncPineTreeWalletRailsEngine(merchantId)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    if (error instanceof RailSyncEngineError) {
      console.warn("[pinetree-wallets] rail_sync_route_failed", {
        stage: error.stage,
        code: error.code,
      })
      return NextResponse.json(
        { ok: false, stage: error.stage, code: error.code },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { ok: false, stage: "rail_sync_failed", code: "unknown_error" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
