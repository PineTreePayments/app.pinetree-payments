import { NextRequest, NextResponse } from "next/server"
import { getPaymentIntentEngine } from "@/engine/paymentIntents"
import { signCheckoutSession } from "@/lib/api/checkoutAuth"

type Params = { params: Promise<{ intentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const id = String(intentId || "").trim()
    const intent = await getPaymentIntentEngine(id)

    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    // Issue a short-lived checkout session token scoped to this intent.
    // The customer uses it to authorise safe cancellation actions (e.g. /fail)
    // without holding merchant credentials.
    const checkoutToken = signCheckoutSession(id)

    return NextResponse.json({ ...intent, checkoutToken })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch payment intent" },
      { status: 500 }
    )
  }
}
