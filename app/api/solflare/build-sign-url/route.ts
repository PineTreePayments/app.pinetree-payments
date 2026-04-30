import { NextRequest, NextResponse } from "next/server"
import { getSolflareDeeplinkSessionByFlowId } from "@/database/solflareDeeplinkSessions"
import { buildServerSignAndSendUrl } from "@/lib/solflareServer"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      flowId?: unknown
      transactionBase64?: unknown
      redirectLink?: unknown
    }
    const flowId = String(body.flowId || "").trim()
    const transactionBase64 = String(body.transactionBase64 || "").trim()
    const redirectLink = String(body.redirectLink || "").trim()

    if (!flowId || !transactionBase64 || !redirectLink) {
      return NextResponse.json({ error: "Missing sign URL fields" }, { status: 400 })
    }

    const flow = await getSolflareDeeplinkSessionByFlowId(flowId)
    if (!flow) {
      return NextResponse.json({ error: "Solflare flow not found" }, { status: 404 })
    }
    if (flow.consumed_at) {
      return NextResponse.json({ error: "Solflare flow already consumed" }, { status: 409 })
    }
    if (!flow.solflare_session || !flow.solflare_encryption_public_key) {
      return NextResponse.json({ error: "Solflare session not connected" }, { status: 400 })
    }

    const signUrl = buildServerSignAndSendUrl({
      transactionBase64,
      session: flow.solflare_session,
      solflareEncryptionPublicKey: flow.solflare_encryption_public_key,
      dappPublicKey: flow.dapp_public_key,
      dappSecretKey: flow.dapp_secret_key,
      redirectLink,
    })

    console.log(
      "[SOLFLARE DEBUG]",
      "sign-url-built",
      JSON.stringify({
        startsWithCorrectEndpoint: signUrl.startsWith(
          "https://solflare.com/ul/v1/signAndSendTransaction",
        ),
        length: signUrl.length,
      }),
    )

    return NextResponse.json({ signUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build Solflare sign URL"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}