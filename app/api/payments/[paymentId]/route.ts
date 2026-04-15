import { NextRequest, NextResponse } from "next/server"
import { getPaymentById } from "@/database"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await context.params

    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    const payment = await getPaymentById(paymentId)

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    return NextResponse.json({ payment })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
