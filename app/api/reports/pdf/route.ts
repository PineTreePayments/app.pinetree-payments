import { NextRequest, NextResponse } from "next/server"
import { generateReportEngine, getReportFilename } from "@/engine/reports"
import { generateReportPdfFromSummary } from "@/engine/reportsPdf"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { searchParams } = new URL(req.url)
    const report = await generateReportEngine({
      merchantId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      type: searchParams.get("type") || undefined,
      status: searchParams.get("status") || undefined
    })
    const pdfBytes = await generateReportPdfFromSummary(report)

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${getReportFilename(report, "pdf")}`
      }
    })
  } catch (error) {
    console.error("[reports:pdf] failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate PDF" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
