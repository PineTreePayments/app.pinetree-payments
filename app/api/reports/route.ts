import { NextRequest, NextResponse } from "next/server"
import { generateReport } from "@/lib/reporting/generateReport"
import { supabase } from "@/lib/database/supabase"

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

    const report = await generateReport({
      merchantId: user.id,
      startDate,
      endDate
    })

    return NextResponse.json(report)

  } catch (error: any) {

    console.error("Report error:", error)

    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    )

  }

}