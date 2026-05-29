import { NextRequest, NextResponse } from "next/server"
import { buildBaseV7AllowancePayment } from "@/engine/baseV7Relayer"

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

    console.info("[POS Base USDC V7] allowance_build_start", { paymentId })

    const result = await buildBaseV7AllowancePayment({ paymentId, payerAddress })

    if (result.ok) {
      console.info("[POS Base USDC V7] allowance_build_resolved", {
        paymentId,
        sufficient: result.sufficient,
        hasApproveTx: Boolean(result.approveTx),
        requiredAmount: result.requiredAmount
      })
    } else {
      console.warn("[BASE V7] build-allowance-payment route unavailable", {
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build Base V7 allowance payment"
    console.error("[BASE V7] build-allowance-payment route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
