import { NextRequest, NextResponse } from "next/server"
import { getPaymentById } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"

export async function POST(
  req: NextRequest,
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

    const status = String(payment.status || "").toUpperCase()
    if (!["CREATED", "PENDING", "PROCESSING"].includes(status)) {
      return NextResponse.json({ detected: false, skipped: true })
    }

    let txHash: string | undefined
    try {
      const body = (await req.json()) as { txHash?: string }
      txHash = body.txHash
    } catch {
      // body is optional
    }

    console.info("[detect] triggered", { paymentId, txHash, network: payment.network })

    const detected = await runPaymentWatcher(payment.id)

    console.info("[detect] result", { paymentId, detected })

    return NextResponse.json({ detected })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detection failed"
    console.error("[detect] error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
