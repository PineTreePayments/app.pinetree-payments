import { NextRequest, NextResponse } from "next/server"
import { generateReportEngine } from "@/engine/reports"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing startDate or endDate" },
        { status: 400 }
      )
    }

    const report = await generateReportEngine({ merchantId, startDate, endDate })
    return NextResponse.json(report)
  } catch (error: unknown) {
    console.error("Report error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate report" },
      { status: getRouteErrorStatus(error) }
    )
  }
}