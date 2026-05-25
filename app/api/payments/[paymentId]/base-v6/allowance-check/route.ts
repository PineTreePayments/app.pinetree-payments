import { NextRequest, NextResponse } from "next/server"
import { checkBaseV6Allowance } from "@/engine/baseV6Relayer"

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

    console.info("[BASE V6] allowance-check route entry", { paymentId, payerAddress })

    const result = await checkBaseV6Allowance({ paymentId, payerAddress })

    console.info("[BASE V6] allowance-check route response", {
      paymentId,
      ok: result.ok,
      sufficient: result.ok ? result.sufficient : null
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check Base V6 allowance"
    console.error("[BASE V6] allowance-check route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
