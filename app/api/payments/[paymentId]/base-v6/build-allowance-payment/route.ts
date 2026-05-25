import { NextRequest, NextResponse } from "next/server"
import { buildBaseV6AllowancePayment } from "@/engine/baseV6Relayer"

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

    console.info("[BASE V6] build-allowance-payment route entry", { paymentId, payerAddress })

    const result = await buildBaseV6AllowancePayment({ paymentId, payerAddress })

    if (result.ok) {
      console.info("[BASE V6] build-allowance-payment route success", {
        paymentId,
        sufficient: result.sufficient,
        hasApproveTx: Boolean(result.approveTx),
        requiredAmount: result.requiredAmount
      })
    } else {
      console.warn("[BASE V6] build-allowance-payment route unavailable", {
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build Base V6 allowance payment"
    console.error("[BASE V6] build-allowance-payment route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
