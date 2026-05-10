import { NextRequest, NextResponse } from "next/server"
import { prepareBaseUsdcV5Authorization } from "@/engine/baseUsdcV5Relayer"

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

    console.info("[PineTreeBaseTrace] v5 prepare called", {
      step: "v5-route-prepare-entry",
      paymentId,
      payerAddress,
      asset: "USDC",
      network: "base"
    })

    const result = await prepareBaseUsdcV5Authorization({ paymentId, payerAddress })

    if (result.ok) {
      console.info("[PineTreeBaseTrace] v5 prepare success", {
        step: "v5-route-prepare-response",
        paymentId,
        asset: "USDC",
        network: "base",
        baseUsdcStrategy: "v5_eip3009_relayer",
        hasTypedData: Boolean((result as Record<string, unknown>).typedData),
        hasAuthorization: Boolean((result as Record<string, unknown>).authorization)
      })
    } else {
      console.warn("[PineTreeBaseTrace] v5 prepare unavailable", {
        step: "v5-route-prepare-unavailable",
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare Base USDC V5 authorization"
    console.error("[PineTreeBaseTrace] v5 prepare error", {
      step: "v5-route-prepare-error",
      paymentId,
      asset: "USDC",
      network: "base",
      error: message
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
