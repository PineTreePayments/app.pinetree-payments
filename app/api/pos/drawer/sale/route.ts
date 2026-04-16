import { NextRequest, NextResponse } from "next/server"
import { recordCashSale } from "@/engine/recordCashSale"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const terminalId = String(body.terminalId || "").trim()
    const merchantId = String(body.merchantId || "").trim()
    const saleTotal = Number(body.saleTotal || 0)
    const cashTendered = Number(body.cashTendered || 0)
    const changeGiven = Number(body.changeGiven || 0)
    const subtotalAmount = Number(body.subtotalAmount || saleTotal)
    const serviceFee = Number(body.serviceFee || 0)

    if (!terminalId || !merchantId) {
      return NextResponse.json({ error: "Missing terminalId or merchantId" }, { status: 400 })
    }

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
      serviceFee
    })

    return NextResponse.json({ success: true, entry: result.entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
