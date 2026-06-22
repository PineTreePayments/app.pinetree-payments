import { NextRequest, NextResponse } from "next/server"
import { recordCashSale } from "@/engine/recordCashSale"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { calculatePosTotalsForTerminal } from "@/engine/posPayments"

export async function POST(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const body = await req.json()
    const cashTendered = Number(body.cashTendered || 0)
    const subtotalAmount = Number(body.subtotalAmount || 0)

    if (subtotalAmount <= 0) {
      return NextResponse.json({ error: "Invalid subtotalAmount" }, { status: 400 })
    }

    const totals = await calculatePosTotalsForTerminal(merchantId, terminalId, subtotalAmount)
    if (cashTendered < totals.totalAmount) {
      return NextResponse.json({ error: "Cash tendered is less than the total due" }, { status: 400 })
    }
    const changeGiven = Math.max(0, cashTendered - totals.totalAmount)

    const result = await recordCashSale({
      terminalId,
      merchantId,
      saleTotal: totals.totalAmount,
      cashTendered,
      changeGiven,
      subtotalAmount,
      serviceFee: totals.serviceFee,
      taxAmount: totals.taxAmount,
      taxRate: totals.taxRate,
    })

    return NextResponse.json({ success: true, entry: result.entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
