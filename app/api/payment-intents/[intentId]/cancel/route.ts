import { NextRequest, NextResponse } from "next/server"
import { cancelPaymentIntentEngine } from "@/engine/paymentIntents"

type Params = { params: Promise<{ intentId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { intentId } = await params
    const id = String(intentId || "").trim()
    if (!id) {
      return NextResponse.json({ error: "Missing intent ID" }, { status: 400 })
    }
    await cancelPaymentIntentEngine(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel payment" },
      { status: 500 }
    )
  }
}
