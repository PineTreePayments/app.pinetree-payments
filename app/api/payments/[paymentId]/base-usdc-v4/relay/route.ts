import { NextRequest, NextResponse } from "next/server"
import { relayBaseUsdcV4Payment } from "@/engine/baseUsdcV4Relayer"

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

    console.info("[PineTreeBaseTrace] relay called", {
      step: "route-entry",
      paymentId,
      payerAddress,
      asset: "USDC",
      network: "base",
      hasAuthorization: Boolean(body.authorization),
      hasSignature: Boolean(body.signature)
    })

    console.info("[PineTreeBaseTrace] relay engine call start", {
      step: "relay-engine-start",
      paymentId,
      asset: "USDC",
      network: "base"
    })

    const result = await relayBaseUsdcV4Payment({
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
      console.info("[PineTreeBaseTrace] relay success", {
        step: "route-response",
        paymentId,
        asset: "USDC",
        network: "base",
        txHash: (result as { txHash?: string }).txHash || null,
        status: (result as { status?: string }).status || null
      })
    } else {
      console.warn("[PineTreeBaseTrace] relay unavailable", {
        step: "route-unavailable",
        paymentId,
        code: (result as Record<string, unknown>).code || null
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to relay Base USDC payment"
    console.error("[PineTreeBaseTrace] relay error", {
      step: "route-error",
      paymentId,
      asset: "USDC",
      network: "base",
      error: message
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}