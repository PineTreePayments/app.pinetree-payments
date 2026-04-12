import { NextRequest, NextResponse } from "next/server"
import { generateReportEngine } from "@/engine/reports"
import { supabase } from "@/database/supabase"

export async function GET(req: NextRequest) {

  try {

    const { searchParams } = new URL(req.url)

    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing startDate or endDate" },
        { status: 400 }
      )
    }

    /* ---------------------------
    GET AUTHENTICATED MERCHANT
    --------------------------- */

    const { data: { user } } =
      await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    /* ---------------------------
    GENERATE REPORT
    --------------------------- */

    const report = await generateReportEngine({
      merchantId: user.id,
      startDate,
      endDate
    })

    return NextResponse.json(report)

  } catch (error: unknown) {

    console.error("Report error:", error)

    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    )

  }

}