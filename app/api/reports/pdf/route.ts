import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/database/supabase"
import { generateReportPdfEngine } from "@/engine/reportsPdf"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const startDate = String(searchParams.get("startDate") || "").trim()
    const endDate = String(searchParams.get("endDate") || "").trim()

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Missing date range" }, { status: 400 })
    }

    const { data } = await supabase.auth.getUser()
    if (!data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const pdfBytes = await generateReportPdfEngine({
      merchantId: data.user.id,
      startDate,
      endDate
    })

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=pinetree-report.pdf"
      }
    })
  } catch (error) {
    console.error("[reports:pdf] failed", error)
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    )
  }
}
