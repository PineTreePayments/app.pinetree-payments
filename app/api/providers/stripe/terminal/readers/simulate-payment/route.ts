import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { presentSimulatedTerminalPaymentEngine } from "@/engine/stripeTerminal"

export async function POST(req: NextRequest) {
  try {
    const { merchantId } = await requireStripeCardMerchant(req)
    const body = await req.json()
    return NextResponse.json(await presentSimulatedTerminalPaymentEngine(merchantId, String(body.paymentId || "")))
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Simulated payment failed" }, { status: getRouteErrorStatus(error) }) }
}
