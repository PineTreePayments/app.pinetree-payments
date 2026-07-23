import { NextRequest, NextResponse } from "next/server"
import { runPaymentDetectForPayment } from "@/engine/paymentDetect"
import { schedulePaymentMaintenance } from "@/lib/api/paymentMaintenance"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const params = await context.params
    const paymentId = String(params.paymentId || "").trim()

    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    schedulePaymentMaintenance("payments.detect")

    let txHash: string | undefined
    let sessionAttemptId: string | undefined
    try {
      const body = (await req.json()) as { txHash?: string; sessionAttemptId?: string }
      txHash = body.txHash
      sessionAttemptId = body.sessionAttemptId
    } catch {
      // body is optional
    }

    const result = await runPaymentDetectForPayment(paymentId, { txHash, sessionAttemptId })
    return NextResponse.json(result.body, { status: result.httpStatus })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detection failed"
    console.error("[detect] error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
