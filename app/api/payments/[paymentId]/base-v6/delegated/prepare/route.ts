import { NextRequest, NextResponse } from "next/server"
import { prepareBaseV6DelegatedPayment } from "@/engine/baseV6Execution"

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

    console.info("[BASE V6 DELEGATED] prepare route entry", {
      paymentId,
      payerAddress,
      strategy: "delegated_v6_batch"
    })

    const result = await prepareBaseV6DelegatedPayment({ paymentId, payerAddress })

    console.info("[BASE V6 DELEGATED] prepare route response", {
      paymentId,
      enabled: result.enabled,
      callCount: result.calls.length,
      requiredUsdcAmount: result.requiredUsdcAmount
    })

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare Base V6 delegated payment"
    console.error("[BASE V6 DELEGATED] prepare route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
