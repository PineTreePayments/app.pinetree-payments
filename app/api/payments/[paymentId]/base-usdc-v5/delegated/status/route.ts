import { NextRequest, NextResponse } from "next/server"
import { resolveBaseUsdcDelegatedStatus } from "@/engine/baseDelegatedEoaExecution"

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
    const txHash = body.txHash ? String(body.txHash).trim() : null

    console.info("[BASE DELEGATED REAL] status-route-entry", {
      paymentId,
      hasCallId: Boolean(callId),
      payerAddress,
      hasTxHash: Boolean(txHash),
    })

    const result = await resolveBaseUsdcDelegatedStatus({ callId, payerAddress, txHash })

    console.info("[BASE DELEGATED REAL] status-route-response", {
      paymentId,
      status: result.status,
      hasTxHash: Boolean(result.txHash),
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Failed to resolve delegated Base USDC payment status"

    console.error("[BASE DELEGATED REAL] status-route-error", {
      paymentId,
      error: message,
    })

    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}