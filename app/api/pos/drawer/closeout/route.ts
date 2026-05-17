import { NextRequest, NextResponse } from "next/server"
import { closeDrawerShift } from "@/engine/cashDrawer"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = await req.json()
    const terminalId = String(body.terminalId || "").trim()
    const actualAmount = Number(body.actualAmount ?? 0)

    if (!terminalId) {
      return NextResponse.json({ error: "Missing terminalId" }, { status: 400 })
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
      entry: result.entry,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
