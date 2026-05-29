import { NextRequest, NextResponse } from "next/server"
import { resolveBaseV7DelegatedStatus } from "@/engine/baseV7Execution"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()
    const body = (await req.json()) as {
      callId?: string
      payerAddress?: string
      txHash?: string | null
    }
    const callId = String(body.callId || "").trim()
    const payerAddress = String(body.payerAddress || "").trim()
    const txHash = body.txHash ?? null

    console.info("[BASE V7 DELEGATED] status route entry", { paymentId, callId })

    const result = await resolveBaseV7DelegatedStatus({ callId, payerAddress, txHash })

    console.info("[BASE V7 DELEGATED] status route response", {
      paymentId,
      status: result.status,
      hasTxHash: Boolean(result.txHash)
    })

    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve Base V7 delegated status"
    console.error("[BASE V7 DELEGATED] status route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
