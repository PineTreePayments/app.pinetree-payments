import { NextRequest, NextResponse } from "next/server"
import { emailReportEngine } from "@/engine/reportEmail"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = (await req.json()) as {
      type?: string
      email?: string
      startDate?: string
      endDate?: string
    }
    const recipientEmail = String(body.email || "").trim()
    const type = String(body.type || "month").trim()

    if (!recipientEmail) {
      return NextResponse.json({ error: "recipient email is required" }, { status: 400 })
    }

    const result = await emailReportEngine({
      merchantId,
      type,
      recipientEmail,
      startDate: body.startDate,
      endDate: body.endDate
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("[reports:email] failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send report email" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
