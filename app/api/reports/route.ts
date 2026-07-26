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
    const requestedPage = Number(searchParams.get("page") || 1)
    const requestedPageSize = Number(searchParams.get("pageSize") || 50)
    const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 50
    const page = Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1)

    const report = await generateReportEngine({
      merchantId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      type,
      status: searchParams.get("status") || undefined
    })
    const totalLedgerRows = report.transactionsTable.length
    const totalPages = Math.max(1, Math.ceil(totalLedgerRows / pageSize))
    const normalizedPage = Math.min(page, totalPages)
    const start = (normalizedPage - 1) * pageSize
    return NextResponse.json({
      ...report,
      transactionsTable: report.transactionsTable.slice(start, start + pageSize),
      totalLedgerRows,
      transactionsTruncated: false,
      pagination: {
        page: normalizedPage,
        pageSize,
        total: totalLedgerRows,
        totalPages
      }
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
