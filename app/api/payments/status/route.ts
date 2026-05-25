import { NextRequest, NextResponse } from "next/server"
import { getPaymentById, getPaymentIntentById } from "@/database"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // Accept either ?paymentId= or ?intentId=
  const id =
    (searchParams.get("paymentId") || searchParams.get("intentId") || "").trim()

  if (!id) {
    return NextResponse.json(
      { error: "Missing paymentId or intentId" },
      { status: 400 }
    )
  }

  try {
    // Try as a direct payment first, then fall back to payment intent
    const payment = await getPaymentById(id)
    if (payment) {
      return NextResponse.json({
        status: payment.status,
        paymentId: payment.id,
        intentId: null
      })
    }

    const intent = await getPaymentIntentById(id)
    if (intent) {
      const selectedPayment = intent.payment_id ? await getPaymentById(intent.payment_id) : null
      const paymentMeta = (selectedPayment?.metadata ?? null) as Record<string, unknown> | null
      const isPosBase =
        paymentMeta?.posTerminalOwned === true &&
        String(selectedPayment?.network || "").toLowerCase() === "base"
      return NextResponse.json({
        status: selectedPayment?.status ?? intent.status,
        paymentId: intent.payment_id ?? null,
        intentId: intent.id,
        ...(isPosBase ? {
          posTerminalOwned: true,
          selectedAsset: String(paymentMeta?.selectedAsset || "ETH").toUpperCase(),
          paymentUrl: String(selectedPayment?.payment_url || ""),
        } : {})
      })
    }

    return NextResponse.json(
      { error: "Payment or intent not found" },
      { status: 404 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve payment status" },
      { status: 500 }
    )
  }
}
