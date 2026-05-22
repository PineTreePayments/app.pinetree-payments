import { NextRequest, NextResponse } from "next/server"
import { getMoonPayOffRampSupportMatrix } from "@/engine/offRampOperations"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    await requireMerchantIdFromRequest(req)

    return NextResponse.json({
      success: true,
      support: getMoonPayOffRampSupportMatrix()
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load off-ramp support") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
