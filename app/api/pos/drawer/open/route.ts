import { NextRequest, NextResponse } from "next/server"
import { openDrawerShift } from "@/engine/cashDrawer"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const terminalId = String(body.terminalId || "").trim()
    const merchantId = String(body.merchantId || "").trim()
    const startingAmount = Number(body.startingAmount || 0)

    if (!terminalId || !merchantId) {
      return NextResponse.json({ error: "Missing terminalId or merchantId" }, { status: 400 })
    }

    const entry = await openDrawerShift(terminalId, merchantId, startingAmount)
    return NextResponse.json({ success: true, entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
