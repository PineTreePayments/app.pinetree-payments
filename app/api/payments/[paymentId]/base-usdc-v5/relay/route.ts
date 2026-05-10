import { NextRequest, NextResponse } from "next/server"
import { relayBaseUsdcV5Payment } from "@/engine/baseUsdcV5Relayer"

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

    console.info("[PineTreeBaseTrace] v5 relay called", {
      step: "v5-route-relay-entry",
      paymentId,
      payerAddress,
      asset: "USDC",
      network: "base",
      hasAuthorization: Boolean(body.authorization),
      hasSignature: Boolean(body.signature)
    })

    const result = await relayBaseUsdcV5Payment({
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
      console.info("[PineTreeBaseTrace] v5 relay success", {
        step: "v5-route-relay-response",
        paymentId,
        asset: "USDC",
        network: "base",
        txHash: (result as { txHash?: string }).txHash || null,
        status: (result as { status?: string }).status || null
      })
    } else {
      console.warn("[PineTreeBaseTrace] v5 relay unavailable", {
        step: "v5-route-relay-unavailable",
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to relay Base USDC V5 payment"
    console.error("[PineTreeBaseTrace] v5 relay error", {
      step: "v5-route-relay-error",
      paymentId,
      asset: "USDC",
      network: "base",
      error: message
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
