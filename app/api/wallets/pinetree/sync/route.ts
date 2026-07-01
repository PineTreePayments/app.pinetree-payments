import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { syncPineTreeWalletBalances } from "@/engine/pineTreeWalletSync"
import { scheduleWalletWithdrawalMaintenance } from "@/lib/api/walletWithdrawalMaintenance"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await syncPineTreeWalletBalances(merchantId)
    scheduleWalletWithdrawalMaintenance("pinetree-wallet.sync")
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync PineTree Wallet"
    return NextResponse.json(
      { error: message },
      { status: getRouteErrorStatus(error) }
    )
  }
}
