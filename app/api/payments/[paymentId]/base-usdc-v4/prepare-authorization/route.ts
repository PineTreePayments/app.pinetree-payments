import { NextRequest, NextResponse } from "next/server"
import { prepareBaseUsdcV4Authorization } from "@/engine/baseUsdcV4Relayer"

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

    console.info("[PineTreeBaseTrace] prepare-authorization called", {
      step: "route-entry",
      paymentId,
      payerAddress,
      asset: "USDC",
      network: "base"
    })

    const result = await prepareBaseUsdcV4Authorization({ paymentId, payerAddress })

    if (result.ok) {
      console.info("[PineTreeBaseTrace] prepare-authorization success", {
        step: "route-response",
        paymentId,
        asset: "USDC",
        network: "base",
        baseUsdcStrategy: "v4_eip3009_relayer",
        hasTypedData: Boolean((result as Record<string, unknown>).typedData),
        hasAuthorization: Boolean((result as Record<string, unknown>).authorization)
      })
    } else {
      console.warn("[PineTreeBaseTrace] prepare-authorization unavailable", {
        step: "route-unavailable",
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare Base USDC authorization"
    console.error("[PineTreeBaseTrace] prepare-authorization error", {
      step: "route-error",
      paymentId,
      asset: "USDC",
      network: "base",
      error: message
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}