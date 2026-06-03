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

    if (!paymentId) {
      return NextResponse.json({ ok: false, error: "Missing paymentId" }, { status: 400 })
    }

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
    const signature    = String(body.signature    || "").trim()

    // Belt-and-suspenders field presence checks before reaching the engine.
    // The engine re-validates all of these cryptographically, but failing
    // fast here gives callers a clear 400 instead of a generic 500 or a
    // confusing engine-level error message.
    if (!payerAddress) {
      return NextResponse.json({ ok: false, error: "Missing payerAddress" }, { status: 400 })
    }
    if (!body.authorization || typeof body.authorization !== "object") {
      return NextResponse.json({ ok: false, error: "Missing authorization object" }, { status: 400 })
    }
    if (!String(body.authorization.validAfter  ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Missing authorization.validAfter" }, { status: 400 })
    }
    if (!String(body.authorization.validBefore ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Missing authorization.validBefore" }, { status: 400 })
    }
    if (!String(body.authorization.nonce       ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Missing authorization.nonce" }, { status: 400 })
    }
    if (!signature) {
      return NextResponse.json({ ok: false, error: "Missing signature" }, { status: 400 })
    }

    console.info("[BASE V7] relay route entry", {
      paymentId,
      hasAuthorization: true,
      hasSignature: true
    })

    const result = await relayBaseV7Payment({
      paymentId,
      payerAddress,
      authorization: {
        validAfter:  String(body.authorization.validAfter).trim(),
        validBefore: String(body.authorization.validBefore).trim(),
        nonce:       String(body.authorization.nonce).trim()
      },
      signature
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
