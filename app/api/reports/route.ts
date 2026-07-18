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
    const type = searchParams.get("type") || undefined

    const report = await generateReportEngine({
      merchantId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      type,
      status: searchParams.get("status") || undefined
    })
    const visibleLedgerLimit = 250
    return NextResponse.json({
      ...report,
      transactionsTable: report.transactionsTable.slice(0, visibleLedgerLimit),
      totalLedgerRows: report.transactionsTable.length,
      transactionsTruncated: report.transactionsTable.length > visibleLedgerLimit
    })
  } catch (error: unknown) {
    const status = getRouteErrorStatus(error)
    // Authentication and validation failures are expected client outcomes;
    // reserve error-level production logs for server-side report failures.
    if (status >= 500) console.error("Report error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate report" },
      { status }
    )
  }
}
