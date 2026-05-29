import { NextRequest, NextResponse } from "next/server"
import { prepareBaseV7DelegatedPayment } from "@/engine/baseV7Execution"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()
    const body = (await req.json()) as { payerAddress?: string }
    const payerAddress = String(body.payerAddress || "").trim()

    console.info("[BASE V7 DELEGATED] prepare route entry", {
      paymentId,
      strategy: "delegated_v7_batch"
    })

    const result = await prepareBaseV7DelegatedPayment({ paymentId, payerAddress })

    console.info("[BASE V7 DELEGATED] prepare route response", {
      paymentId,
      enabled: result.enabled,
      callCount: result.calls.length,
      requiredUsdcAmount: result.requiredUsdcAmount
    })

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare Base V7 delegated payment"
    console.error("[BASE V7 DELEGATED] prepare route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
