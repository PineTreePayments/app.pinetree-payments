import { NextRequest, NextResponse } from "next/server"
import { createPayment } from "@/lib/engine/createPayment"
import { PaymentProvider } from "@/types/payment"

type CreatePaymentBody = {
  amount: number
  currency: string
  provider?: PaymentProvider
  merchantId: string
  terminalId?: string
  pinetreeFee?: number
  metadata?: any
}

export async function POST(req: NextRequest) {

  try {

    const body = (await req.json()) as CreatePaymentBody

    const idempotencyKey =
      req.headers.get("idempotency-key") || undefined

    /* ---------------------------
       BASIC VALIDATION
    --------------------------- */

    if (
      body.amount === undefined ||
      !body.currency ||
      !body.merchantId
    ) {
      return NextResponse.json(
        { error: "Missing required payment fields" },
        { status: 400 }
      )
    }

    const merchantAmount = Number(body.amount)

    if (isNaN(merchantAmount) || merchantAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid payment amount" },
        { status: 400 }
      )
    }

    /* ---------------------------
       PROVIDER VALIDATION
    --------------------------- */

    if (!body.provider) {
      return NextResponse.json(
        { error: "No payment provider connected" },
        { status: 400 }
      )
    }

    /* ---------------------------
       PINETREE FEE CALCULATION
    --------------------------- */

    const pinetreeFee = body.pinetreeFee ?? 0.15
    const grossAmount = merchantAmount + pinetreeFee

    /* ---------------------------
       CREATE PAYMENT
    --------------------------- */

    const payment = await createPayment({
      amount: grossAmount,
      currency: body.currency,
      provider: body.provider,
      merchantId: body.merchantId,
      metadata: {
        ...body.metadata,
        terminalId: body.terminalId,
        merchantAmount,
        pinetreeFee
      },
      idempotencyKey
    })

    /* ---------------------------
       RETURN RESULT
    --------------------------- */

    return NextResponse.json({
      paymentId: payment.id,
      provider: payment.provider,
      paymentUrl: payment.paymentUrl,
      qrCodeUrl: payment.qrCodeUrl
    })

  } catch (error:any) {

    console.error("Payment creation error:", error)

    return NextResponse.json(
      { error: "Payment creation failed" },
      { status: 500 }
    )

  }

}