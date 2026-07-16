import { NextRequest, NextResponse } from "next/server"
import { createPosPaymentIntentEngine } from "@/engine/posPayments"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

/**
 * Explicit card fallback for a cashier who chose "Send Payment Link".
 * The primary POS Card action never calls this route and never opens checkout.
 */
export async function POST(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)
    const body = await req.json()
    const result = await createPosPaymentIntentEngine({
      amount: Number(body.amount),
      currency: String(body.currency || "USD"),
      terminal: { merchantId, terminalId, preferredNetwork: "stripe" },
    })

    return NextResponse.json({
      intentId: result.intentId,
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create a card payment link." },
      { status: getRouteErrorStatus(error) }
    )
  }
}
