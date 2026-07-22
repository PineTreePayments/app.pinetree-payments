import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { syncPineTreeWalletBalances } from "@/engine/pineTreeWalletSync"
import { scheduleWalletWithdrawalMaintenance } from "@/lib/api/walletWithdrawalMaintenance"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await syncPineTreeWalletBalances(merchantId)
    scheduleWalletWithdrawalMaintenance("pinetree-wallet.sync")
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync PineTree Wallet"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
