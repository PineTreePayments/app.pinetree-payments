/**
 * POST /api/payments
 *
 * Canonical payment creation endpoint.
 * Strict flow: UI -> /api/payments -> engine/createPayment
 */

import { NextRequest, NextResponse } from "next/server"
import { buildCreatePaymentRequest, createPayment } from "@/engine/createPayment"

type CreatePaymentBody = {
  amount: number
  currency: string
  provider?: "solana" | "coinbase" | "shift4"
  merchantId: string
  terminalId?: string
  metadata?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreatePaymentBody

    const idempotencyKey =
      req.headers.get("idempotency-key") || undefined

    const { createPaymentInput, breakdown } = await buildCreatePaymentRequest({
      amount: body.amount,
      currency: body.currency,
      provider: body.provider,
      merchantId: body.merchantId,
      terminalId: body.terminalId,
      metadata: body.metadata
    })

    const payment = await createPayment({
      ...createPaymentInput,
      idempotencyKey
    })

    return NextResponse.json({
      paymentId: payment.id,
      provider: payment.provider,
      paymentUrl: payment.paymentUrl,
      qrCodeUrl: payment.qrCodeUrl,
      breakdown
    })
  } catch (error: unknown) {
    console.error("Payment creation error:", error)

    const message = error instanceof Error ? error.message : "Payment creation failed"
    const status =
      message === "Missing required payment fields" ||
      message === "Invalid payment amount" ||
      message === "No payment provider connected"
        ? 400
        : 500

    return NextResponse.json(
      { error: "Payment creation failed", details: message },
      { status }
    )
  }
}