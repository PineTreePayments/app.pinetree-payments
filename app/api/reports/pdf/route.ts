import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { generateReportPdfEngine } from "@/engine/reportsPdf"

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization")

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 })
    }

    const accessToken = authHeader.slice(7)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const client = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error: authError } = await client.auth.getUser(accessToken)

    if (authError || !user) {
      return new Response("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const startDate = String(searchParams.get("startDate") || "").trim()
    const endDate = String(searchParams.get("endDate") || "").trim()

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Missing date range" }, { status: 400 })
    }

    const pdfBytes = await generateReportPdfEngine({
      merchantId: user.id,
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
