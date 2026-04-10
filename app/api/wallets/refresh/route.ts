import { NextRequest, NextResponse } from "next/server"
import { refreshWalletBalancesEngine, getWalletOverviewEngine } from "@/engine/walletOverview"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const refreshed = await refreshWalletBalancesEngine(merchantId)
    const overview = await getWalletOverviewEngine(merchantId, { refresh: false })

    return NextResponse.json({
      success: true,
      timestamp: refreshed.timestamp,
      balances: [
        { asset: "SOL", balance: refreshed.totalsByAsset.SOL },
        { asset: "ETH", balance: refreshed.totalsByAsset.ETH }
      ],
      wallets: overview.wallets,
      totalUsd: overview.totalUsd,
      prices: overview.prices
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Refresh failed") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
