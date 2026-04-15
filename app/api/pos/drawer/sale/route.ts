import { NextRequest, NextResponse } from "next/server"
import { logCashSale } from "@/engine/cashDrawer"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const terminalId = String(body.terminalId || "").trim()
    const merchantId = String(body.merchantId || "").trim()
    const saleTotal = Number(body.saleTotal || 0)
    const cashTendered = Number(body.cashTendered || 0)
    const changeGiven = Number(body.changeGiven || 0)

    if (!terminalId || !merchantId) {
      return NextResponse.json({ error: "Missing terminalId or merchantId" }, { status: 400 })
    }

    if (saleTotal <= 0) {
      return NextResponse.json({ error: "Invalid saleTotal" }, { status: 400 })
    }

    const entry = await logCashSale(terminalId, merchantId, saleTotal, cashTendered, changeGiven)
    return NextResponse.json({ success: true, entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
