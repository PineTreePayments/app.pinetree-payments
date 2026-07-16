import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { createManualEntryPaymentEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const auth = await requireStripeCardMerchant(req)
    const body = await req.json()
    const result = await createManualEntryPaymentEngine({
      merchantId: auth.merchantId,
      paymentId: body.paymentId,
      posTerminalId: auth.terminalId || body.posTerminalId,
      subtotalAmount: body.amount,
      currency: body.currency
    })
    return NextResponse.json({
      paymentId: result.paymentId,
      clientSecret: result.clientSecret,
      stripeAccountId: result.stripeAccountId,
      status: result.status
    }, { headers: { "Cache-Control": "no-store, private" } })
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Manual card entry failed" }, { status: getRouteErrorStatus(error) }) }
}
