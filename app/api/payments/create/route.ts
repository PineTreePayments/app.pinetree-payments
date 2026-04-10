/**
 * POST /api/payments/create
 * 
 * Creates a new payment in the PineTree system.
 * This is the main entry point for POS and checkout payment creation.
 */

import { NextRequest, NextResponse } from "next/server"
import { createPayment } from "@/engine/createPayment"
import { PaymentProvider } from "@/types/payment"
import { calculateGrossAmount, calculateTax } from "@/engine/fees"
import { getMerchantTaxSettings } from "@/lib/database/merchants"

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
       TAX CALCULATION
    --------------------------- */

    let totalAmount = merchantAmount
    let taxAmount = 0

    // Get merchant tax settings if available
    try {
      const taxSettings = await getMerchantTaxSettings(body.merchantId)
      
      if (taxSettings.taxEnabled && taxSettings.taxRate > 0) {
        taxAmount = calculateTax(merchantAmount, taxSettings.taxRate)
        totalAmount = merchantAmount + taxAmount
      }
    } catch (err) {
      // Tax settings not configured, continue without tax
      console.warn("Tax settings not available:", err)
    }

    /* ---------------------------
       PINETREE FEE CALCULATION
    --------------------------- */

    const pinetreeFee = body.pinetreeFee ?? 0.15
    const grossAmount = calculateGrossAmount(totalAmount, pinetreeFee)

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
        taxAmount,
        pinetreeFee,
        totalAmount
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
      qrCodeUrl: payment.qrCodeUrl,
      breakdown: {
        merchantAmount,
        taxAmount,
        pinetreeFee,
        grossAmount
      }
    })

  } catch (error: any) {
    console.error("Payment creation error:", error)

    return NextResponse.json(
      { error: "Payment creation failed", details: error.message },
      { status: 500 }
    )
  }
}