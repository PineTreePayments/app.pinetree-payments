import { NextRequest, NextResponse } from "next/server"
import { createPosPaymentIntentEngine } from "@/engine/posPayments"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const body = await req.json()
    const { amount, currency } = body

    if (!amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const result = await createPosPaymentIntentEngine({
      amount: Number(amount),
      currency: String(currency || "USD"),
      terminal: { merchantId, terminalId },
    })

    console.info("[api/pos/payment] returning paymentUrl", {
      paymentId: result.paymentId,
      intentId: result.intentId,
      paymentUrl: result.paymentUrl,
    })

    return NextResponse.json({
      paymentId: result.paymentId,
      intentId: result.intentId,
      paymentUrl: result.paymentUrl,
      qrCodeUrl: result.qrCodeUrl,
      breakdown: result.breakdown,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
