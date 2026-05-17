import { NextRequest, NextResponse } from "next/server"
import { recordCashSale } from "@/engine/recordCashSale"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const body = await req.json()
    const saleTotal = Number(body.saleTotal || 0)
    const cashTendered = Number(body.cashTendered || 0)
    const changeGiven = Number(body.changeGiven || 0)
    const subtotalAmount = Number(body.subtotalAmount || saleTotal)
    const serviceFee = Number(body.serviceFee || 0)

    if (saleTotal <= 0) {
      return NextResponse.json({ error: "Invalid saleTotal" }, { status: 400 })
    }

    const result = await recordCashSale({
      terminalId,
      merchantId,
      saleTotal,
      cashTendered,
      changeGiven,
      subtotalAmount,
      serviceFee,
    })

    return NextResponse.json({ success: true, entry: result.entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
