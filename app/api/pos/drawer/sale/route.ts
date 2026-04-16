import { NextRequest, NextResponse } from "next/server"
import { logCashSale } from "@/engine/cashDrawer"
import { createPayment } from "@/database/payments"
import { createTransaction } from "@/database/transactions"

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
    const merchantAmount = saleTotal - serviceFee

    if (!terminalId || !merchantId) {
      return NextResponse.json({ error: "Missing terminalId or merchantId" }, { status: 400 })
    }

    if (saleTotal <= 0) {
      return NextResponse.json({ error: "Invalid saleTotal" }, { status: 400 })
    }

    const paymentId = crypto.randomUUID()
    const transactionId = crypto.randomUUID()

    // Run all three inserts in parallel — drawer log is the source of truth for cash;
    // payment + transaction records make cash sales visible in the dashboard.
    const [entry] = await Promise.all([
      logCashSale(terminalId, merchantId, saleTotal, cashTendered, changeGiven),
      createPayment({
        id: paymentId,
        merchant_id: merchantId,
        merchant_amount: merchantAmount > 0 ? merchantAmount : saleTotal,
        pinetree_fee: serviceFee,
        gross_amount: saleTotal,
        currency: "USD",
        provider: "cash",
        status: "CONFIRMED",
        metadata: { channel: "pos", terminalId, subtotalAmount, cashTendered, changeGiven }
      }),
      createTransaction({
        id: transactionId,
        payment_id: paymentId,
        merchant_id: merchantId,
        provider: "cash",
        channel: "pos",
        total_amount: saleTotal,
        subtotal_amount: subtotalAmount,
        platform_fee: serviceFee,
        status: "CONFIRMED"
      })
    ])

    return NextResponse.json({ success: true, entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
