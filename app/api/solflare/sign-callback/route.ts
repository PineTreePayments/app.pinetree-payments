import { NextRequest, NextResponse } from "next/server"
import {
  consumeSolflareDeeplinkSession,
  getSolflareDeeplinkSessionByFlowId,
} from "@/database/solflareDeeplinkSessions"
import { decryptServerSignResponse } from "@/lib/solflareServer"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      flowId?: unknown
      nonce?: unknown
      data?: unknown
      signature?: unknown
    }
    const flowId = String(body.flowId || "").trim()
    const nonce = body.nonce == null ? null : String(body.nonce).trim()
    const data = body.data == null ? null : String(body.data).trim()
    const rawSignature = body.signature == null ? null : String(body.signature).trim()

    if (!flowId) {
      return NextResponse.json({ ok: false, error: "Missing flowId" }, { status: 400 })
    }

    const flow = await getSolflareDeeplinkSessionByFlowId(flowId)
    if (!flow) {
      return NextResponse.json({ ok: false, error: "Solflare flow not found" }, { status: 404 })
    }
    if (!flow.solflare_encryption_public_key) {
      return NextResponse.json({ ok: false, error: "Missing Solflare encryption key" }, { status: 400 })
    }

    const signature = decryptServerSignResponse({
      solflareEncryptionPublicKey: flow.solflare_encryption_public_key,
      nonce,
      data,
      rawSignature,
      dappSecretKey: flow.dapp_secret_key,
    })

    if (!signature) {
      return NextResponse.json(
        {
          ok: false,
          error: "sign_decrypt_failed",
          paymentId: flow.payment_id,
          intentId: flow.intent_id,
        },
        { status: 400 },
      )
    }

    await consumeSolflareDeeplinkSession(flowId)

    return NextResponse.json({
      ok: true,
      paymentId: flow.payment_id,
      intentId: flow.intent_id,
      signature,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to handle Solflare sign callback"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}