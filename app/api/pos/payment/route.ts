import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const { amount, currency, terminal } = body

    if (!amount || !terminal?.merchantId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    /* =========================
       CREATE PAYMENT RECORD
    ========================= */

    const { data, error } = await supabase
      .from("payments")
      .insert({
        merchant_id: terminal.merchantId,
        merchant_amount: amount,
        pinetree_fee: 0.15,
        gross_amount: amount + 0.15,
        currency: currency || "USD",
        status: "CREATED",
        provider: terminal.provider || "SOLANA"
      })
      .select()
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to create payment" },
        { status: 500 }
      )
    }

    /* =========================
       MOCK QR (TEMP)
    ========================= */

    const paymentUrl = `pinetree://pay/${data.id}`

    return NextResponse.json({
      paymentId: data.id,
      paymentUrl,
      breakdown: {
        subtotalAmount: amount,
        taxAmount: 0,
        serviceFee: 0.15,
        grossAmount: amount + 0.15,
        totalAmount: amount + 0.15
      }
    })

  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}