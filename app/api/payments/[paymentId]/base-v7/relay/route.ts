import { NextRequest, NextResponse } from "next/server"
import { relayBaseV7Payment } from "@/engine/baseV7Relayer"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  let paymentId = ""
  try {
    const params = await context.params
    paymentId = String(params.paymentId || "").trim()
    const body = (await req.json()) as {
      payerAddress?: string
      authorization?: {
        validAfter?: string
        validBefore?: string
        nonce?: string
      }
      signature?: string
    }
    const payerAddress = String(body.payerAddress || "").trim()

    console.info("[BASE V7] relay route entry", {
      paymentId,
      hasAuthorization: Boolean(body.authorization),
      hasSignature: Boolean(body.signature)
    })

    const result = await relayBaseV7Payment({
      paymentId,
      payerAddress,
      authorization: {
        validAfter: String(body.authorization?.validAfter || ""),
        validBefore: String(body.authorization?.validBefore || ""),
        nonce: String(body.authorization?.nonce || "")
      },
      signature: String(body.signature || "").trim()
    })

    if (result.ok) {
      console.info("[POS Base USDC V7] relay_resolved", {
        paymentId,
        txHash: (result as { txHash?: string }).txHash || null,
        status: (result as { status?: string }).status || null
      })
    } else {
      console.warn("[BASE V7] relay route unavailable", {
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to relay Base V7 payment"
    console.error("[BASE V7] relay route error", { paymentId, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
