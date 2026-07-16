import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireStripeCardMerchant } from "@/lib/api/stripeTerminalAuth"
import { getTerminalPaymentEngine } from "@/engine/stripeTerminal"

export async function GET(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  try { const auth = await requireStripeCardMerchant(req); const { paymentId } = await params; return NextResponse.json(await getTerminalPaymentEngine(auth.merchantId, paymentId)) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Terminal payment request failed" }, { status: getRouteErrorStatus(error) }) }
}
