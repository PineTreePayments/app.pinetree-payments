import { NextRequest, NextResponse } from "next/server"
import { prepareBaseUsdcDelegatedPayment } from "@/engine/baseDelegatedEoaExecution"

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

    console.info("[BASE DELEGATED REAL] prepare-route-entry", {
      paymentId,
      payerAddress,
      strategy: "delegated_eoa_batch",
    })

    const result = await prepareBaseUsdcDelegatedPayment({ paymentId, payerAddress })

    console.info("[BASE DELEGATED REAL] prepare-route-response", {
      paymentId,
      enabled: result.enabled,
      callCount: result.calls.length,
      requiredUsdcAmount: result.requiredUsdcAmount,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Failed to prepare delegated Base USDC payment"

    console.error("[BASE DELEGATED REAL] prepare-route-error", {
      paymentId,
      error: message,
    })

    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}