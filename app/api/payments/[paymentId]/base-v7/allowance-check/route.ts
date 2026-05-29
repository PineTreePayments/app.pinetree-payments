import { NextRequest, NextResponse } from "next/server"
import { checkBaseV7Allowance } from "@/engine/baseV7Relayer"

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

    console.info("[POS Base USDC V7] allowance_check_start", { paymentId })

    const result = await checkBaseV7Allowance({ paymentId, payerAddress })

    console.info("[POS Base USDC V7] allowance_check_resolved", {
      paymentId,
      ok: result.ok,
      sufficient: result.ok ? result.sufficient : null
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check Base V7 allowance"
    console.error("[BASE V7] allowance-check route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
