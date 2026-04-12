import { NextRequest, NextResponse } from "next/server"
import { getUnifiedPaymentStatusEngine } from "@/engine/paymentStatusOrchestrator"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const paymentId = searchParams.get("paymentId")

  if (!paymentId) {
    return NextResponse.json(
      { error: "Missing paymentId" },
      { status: 400 }
    )
  }

  try {
    const resolved = await getUnifiedPaymentStatusEngine(paymentId, "api:payments-status")

    return NextResponse.json({
      status: resolved.status,
      paymentId: resolved.paymentId,
      intentId: resolved.intentId
    })
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status: number }).status)
        : 500

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve payment status" },
      { status }
    )
  }

}