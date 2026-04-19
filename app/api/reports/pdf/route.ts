import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { generateReportPdfEngine } from "@/engine/reportsPdf"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const startDate = String(searchParams.get("startDate") || "").trim()
    const endDate = String(searchParams.get("endDate") || "").trim()

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Missing date range" }, { status: 400 })
    }

    // Accept token from Authorization header OR ?token= query param
    // (window.open cannot set headers, so query param is needed for PDF download)
    const authHeader = req.headers.get("authorization") || ""
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : String(searchParams.get("token") || "").trim()

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const client = createClient(supabaseUrl, supabaseAnonKey)
    const { data: authData, error: authError } = await client.auth.getUser(accessToken)

    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const pdfBytes = await generateReportPdfEngine({
      merchantId: authData.user.id,
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
