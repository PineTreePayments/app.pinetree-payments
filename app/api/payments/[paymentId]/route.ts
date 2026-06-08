import { NextRequest, NextResponse } from "next/server"
import { getPaymentById } from "@/database"
import { ensurePaymentFresh } from "@/engine/paymentMaintenance"
import { schedulePaymentMaintenance } from "@/lib/api/paymentMaintenance"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await context.params

    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    schedulePaymentMaintenance("payments.detail")
    await ensurePaymentFresh(paymentId)
    const payment = await getPaymentById(paymentId)

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    // Return only public-safe fields. Internal fields (merchant_id, merchant_amount,
    // pinetree_fee, provider_reference, metadata, payment_url, qr_code_url) are omitted.
    const safePayment = {
      id: payment.id,
      status: payment.status,
      gross_amount: payment.gross_amount,
      currency: payment.currency,
      network: payment.network ?? null,
      provider: payment.provider,
      created_at: payment.created_at,
    }

    return NextResponse.json({ payment: safePayment })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
