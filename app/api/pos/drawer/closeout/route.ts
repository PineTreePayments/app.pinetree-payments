import { NextRequest, NextResponse } from "next/server"
import { closeDrawerShift } from "@/engine/cashDrawer"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const terminalId = String(body.terminalId || "").trim()
    const merchantId = String(body.merchantId || "").trim()
    const actualAmount = Number(body.actualAmount ?? 0)

    if (!terminalId || !merchantId) {
      return NextResponse.json({ error: "Missing terminalId or merchantId" }, { status: 400 })
    }

    if (!Number.isFinite(actualAmount) || actualAmount < 0) {
      return NextResponse.json({ error: "Invalid actualAmount" }, { status: 400 })
    }

    const result = await closeDrawerShift(terminalId, merchantId, actualAmount)

    return NextResponse.json({
      success: true,
      expectedBalance: result.expectedBalance,
      actualAmount,
      discrepancy: result.discrepancy,
      entry: result.entry
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
