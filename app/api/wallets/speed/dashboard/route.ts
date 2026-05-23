import { NextRequest, NextResponse } from "next/server"
import { getSpeedSetupStatusForMerchant } from "@/engine/walletOverview"
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
    const setupStatus = await getSpeedSetupStatusForMerchant(merchantId)

    if (!setupStatus.connected) {
      return NextResponse.json(
        { error: "Speed provider is not connected for this merchant." },
        { status: 404 }
      )
    }

    if (!setupStatus.dashboardUrlConfigured || !setupStatus.dashboardUrl) {
      return NextResponse.json(
        { error: "Speed dashboard URL is not configured." },
        { status: 503 }
      )
    }

    return NextResponse.redirect(setupStatus.dashboardUrl)
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to open Speed dashboard") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
