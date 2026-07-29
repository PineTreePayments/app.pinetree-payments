import { NextRequest, NextResponse } from "next/server"
import { abandonPaymentIntentEngine, PaymentAlreadySubmittedError } from "@/engine/paymentIntents"
import { verifyCheckoutSession } from "@/lib/api/checkoutAuth"
import { normalizePaymentCorrelationId, PAYMENT_CORRELATION_HEADER } from "@/lib/payment/paymentCorrelation"

type Params = { params: Promise<{ intentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { intentId: rawIntentId } = await params
  const intentId = String(rawIntentId || "").trim()
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

  if (!intentId || !token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const claims = verifyCheckoutSession(token)
    if (claims.iid !== intentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await abandonPaymentIntentEngine(
      intentId,
      normalizePaymentCorrelationId(req.headers.get(PAYMENT_CORRELATION_HEADER))
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = error instanceof PaymentAlreadySubmittedError ? 409 : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to end payment attempt" },
      { status }
    )
  }
}
