import { NextRequest, NextResponse } from "next/server"
import { getPaymentIntentEngine } from "@/engine/paymentIntents"

type Params = { params: Promise<{ intentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const intent = await getPaymentIntentEngine(String(intentId || "").trim())

    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    return NextResponse.json(intent)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch payment intent" },
      { status: 500 }
    )
  }
}
