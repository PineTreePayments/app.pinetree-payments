import { NextRequest, NextResponse } from "next/server"
import {
  generateReportCsv,
  generateReportEngine,
  getReportFilename,
  normalizeReportType
} from "@/engine/reports"
import { generateReportPdfFromSummary } from "@/engine/reportsPdf"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { searchParams } = new URL(req.url)
    const type = normalizeReportType(searchParams.get("type"))
    const format = type === "transactions" ? "csv" : "pdf"
    const report = await generateReportEngine({
      merchantId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      type
    })

    if (format === "csv") {
      return new Response(generateReportCsv(report), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=${getReportFilename(report, "csv")}`
        }
      })
    }

    const pdfBytes = await generateReportPdfFromSummary(report)
    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${getReportFilename(report, "pdf")}`
      }
    })
  } catch (error) {
    console.error("[reports:download] failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate report" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
