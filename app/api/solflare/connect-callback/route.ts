import { NextRequest, NextResponse } from "next/server"
import {
  consumeSolflareDeeplinkSession,
  getSolflareDeeplinkSessionByFlowId,
  storeSolflareConnectSession,
} from "@/database/solflareDeeplinkSessions"
import { decryptServerConnectResponse } from "@/lib/solflareServer"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      flowId?: unknown
      solflareEncryptionPublicKey?: unknown
      nonce?: unknown
      data?: unknown
    }
    const flowId = String(body.flowId || "").trim()
    const solflareEncryptionPublicKey = String(body.solflareEncryptionPublicKey || "").trim()
    const nonce = String(body.nonce || "").trim()
    const data = String(body.data || "").trim()

    console.log(
      "[SOLFLARE DEBUG]",
      "connect-callback-received",
      JSON.stringify({
        flowIdPrefix: flowId ? flowId.slice(0, 8) : "MISSING",
        hasNonce: !!nonce,
        hasData: !!data,
        hasSolflarePubKey: !!solflareEncryptionPublicKey,
      }),
    )

    if (!flowId || !solflareEncryptionPublicKey || !nonce || !data) {
      return NextResponse.json({ ok: false, error: "Missing Solflare callback fields" }, { status: 400 })
    }

    const flow = await getSolflareDeeplinkSessionByFlowId(flowId)
    if (!flow) {
      return NextResponse.json({ ok: false, error: "Solflare flow not found" }, { status: 404 })
    }
    if (flow.consumed_at) {
      return NextResponse.json({ ok: false, error: "Solflare flow already consumed" }, { status: 409 })
    }

    const session = decryptServerConnectResponse({
      solflareEncryptionPublicKey,
      nonce,
      data,
      dappSecretKey: flow.dapp_secret_key,
    })

    console.log(
      "[SOLFLARE DEBUG]",
      "connect-callback-decrypt-result",
      JSON.stringify({
        success: !!session,
        hasPublicKey: !!session?.publicKey,
        hasSession: !!session?.session,
      }),
    )

    if (!session) {
      await consumeSolflareDeeplinkSession(flowId).catch(() => null)
      return NextResponse.json(
        {
          ok: false,
          error: "connect_decrypt_failed",
          paymentId: flow.payment_id,
          intentId: flow.intent_id,
        },
        { status: 400 },
      )
    }

    await storeSolflareConnectSession({
      flow_id: flowId,
      solflare_session: session.session,
      solflare_wallet_public_key: session.publicKey,
      solflare_encryption_public_key: session.sfPublicKey,
    })

    return NextResponse.json({
      ok: true,
      paymentId: flow.payment_id,
      intentId: flow.intent_id,
      selectedAsset: flow.selected_asset,
      walletPublicKey: session.publicKey,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to handle Solflare callback"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}