import { NextRequest, NextResponse } from "next/server"
import { getPaymentById } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import type { StoredPaymentSplitMetadata } from "@/types/payment"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  let isBase = false
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()

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

    isBase = String(payment.network || "").toLowerCase() === "base"

    if (isBase) {
      const split = ((payment.metadata ?? null) as StoredPaymentSplitMetadata | null)?.split
      console.info("[PineTreeBaseTrace] detect called", {
        step: "detect-entry",
        paymentId,
        txHash: txHash || null,
        network: payment.network,
        asset: split?.asset || null,
        baseUsdcStrategy: split?.baseUsdcStrategy || null,
        splitContract: split?.splitContract || null,
        paymentStatus: payment.status
      })
    }

    console.info("[detect] triggered", { paymentId, txHash, network: payment.network })

    if (isBase) {
      console.info("[PineTreeBaseTrace] detect watcher start", {
        step: "detect-watcher-start",
        paymentId,
        txHash: txHash || null,
        network: payment.network
      })
    }

    const detected = await runPaymentWatcher(payment.id, { txHash })

    if (isBase) {
      console.info("[PineTreeBaseTrace] detect watcher result", {
        step: "detect-watcher-done",
        paymentId,
        txHash: txHash || null,
        network: payment.network,
        detected
      })
    }

    console.info("[detect] result", { paymentId, detected })

    return NextResponse.json({ detected })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detection failed"
    console.error("[detect] error:", message)
    if (isBase) {
      console.error("[PineTreeBaseTrace] detect error", {
        step: "detect-error",
        paymentId,
        error: message
      })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
