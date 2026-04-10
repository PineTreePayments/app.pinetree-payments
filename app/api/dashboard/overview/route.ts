import { NextRequest, NextResponse } from "next/server"
import {
  getDashboardOverviewEngine,
  syncDashboardOverviewEngine
} from "@/engine/dashboardOverview"
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
    const sync = req.nextUrl.searchParams.get("sync") === "1"
    const data = sync
      ? await syncDashboardOverviewEngine(merchantId)
      : await getDashboardOverviewEngine(merchantId)

    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load dashboard overview") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
