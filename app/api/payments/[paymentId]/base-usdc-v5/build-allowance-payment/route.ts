import { NextRequest, NextResponse } from "next/server"
import { buildBaseUsdcV5AllowancePayment } from "@/engine/baseUsdcV5Relayer"

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

    console.info("[PineTreeBaseTrace] v5 build-allowance-payment called", {
      step: "v5-route-build-allowance-entry",
      paymentId,
      payerAddress,
      asset: "USDC",
      network: "base"
    })

    const result = await buildBaseUsdcV5AllowancePayment({ paymentId, payerAddress })

    if (result.ok) {
      console.info("[PineTreeBaseTrace] v5 build-allowance-payment success", {
        step: "v5-route-build-allowance-response",
        paymentId,
        sufficient: result.sufficient,
        hasApproveTx: Boolean(result.approveTx),
        requiredAmount: result.requiredAmount
      })
    } else {
      console.warn("[PineTreeBaseTrace] v5 build-allowance-payment unavailable", {
        step: "v5-route-build-allowance-unavailable",
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build Base USDC V5 allowance payment"
    console.error("[PineTreeBaseTrace] v5 build-allowance-payment error", {
      step: "v5-route-build-allowance-error",
      paymentId,
      asset: "USDC",
      network: "base",
      error: message
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
