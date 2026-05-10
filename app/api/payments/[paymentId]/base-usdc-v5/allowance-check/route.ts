import { NextRequest, NextResponse } from "next/server"
import { checkBaseUsdcV5Allowance } from "@/engine/baseUsdcV5Relayer"

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

    console.info("[PineTreeBaseTrace] v5 allowance-check called", {
      step: "v5-route-allowance-check-entry",
      paymentId,
      payerAddress,
      asset: "USDC",
      network: "base"
    })

    const result = await checkBaseUsdcV5Allowance({ paymentId, payerAddress })

    console.info("[PineTreeBaseTrace] v5 allowance-check result", {
      step: "v5-route-allowance-check-response",
      paymentId,
      ok: result.ok,
      sufficient: result.ok ? result.sufficient : null
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check Base USDC V5 allowance"
    console.error("[PineTreeBaseTrace] v5 allowance-check error", {
      step: "v5-route-allowance-check-error",
      paymentId,
      asset: "USDC",
      network: "base",
      error: message
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
