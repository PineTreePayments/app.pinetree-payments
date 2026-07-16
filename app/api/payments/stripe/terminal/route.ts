import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { createTerminalPaymentEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const auth = await requireStripeCardMerchant(req)
    const body = await req.json()
    const posTerminalId = auth.terminalId || String(body.posTerminalId || "")
    return NextResponse.json(await createTerminalPaymentEngine({ merchantId: auth.merchantId, posTerminalId, subtotalAmount: body.amount, paymentId: body.paymentId, readerId: body.readerId, currency: body.currency }))
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Terminal payment failed" }, { status: getRouteErrorStatus(error) }) }
}
