import { NextRequest, NextResponse } from "next/server"
import { getWalletOverviewEngine } from "@/lib/engine/walletOverview"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const refresh = req.nextUrl.searchParams.get("refresh") === "1"
    const data = await getWalletOverviewEngine(merchantId, { refresh })

    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load wallet overview") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
