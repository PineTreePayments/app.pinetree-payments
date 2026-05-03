import { NextRequest, NextResponse } from "next/server"
import { relayBaseUsdcV4Payment } from "@/engine/baseUsdcV4Relayer"

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await context.params
    const body = (await req.json()) as {
      payerAddress?: string
      authorization?: {
        validAfter?: string
        validBefore?: string
        nonce?: string
      }
      signature?: string
    }

    const result = await relayBaseUsdcV4Payment({
      paymentId: String(paymentId || "").trim(),
      payerAddress: String(body.payerAddress || "").trim(),
      authorization: {
        validAfter: String(body.authorization?.validAfter || ""),
        validBefore: String(body.authorization?.validBefore || ""),
        nonce: String(body.authorization?.nonce || "")
      },
      signature: String(body.signature || "").trim()
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to relay Base USDC payment"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}