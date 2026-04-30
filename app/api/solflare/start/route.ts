import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createSolflareDeeplinkSession } from "@/database/solflareDeeplinkSessions"
import {
  buildServerConnectUrl,
  createServerSolflareKeypair,
} from "@/lib/solflareServer"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      paymentId?: unknown
      intentId?: unknown
      selectedAsset?: unknown
    }
    const paymentId = String(body.paymentId || "").trim()
    const intentId = String(body.intentId || "").trim()
    const selectedAsset = String(body.selectedAsset || "SOL").trim().toUpperCase()

    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }
    if (!intentId) {
      return NextResponse.json({ error: "Missing intentId" }, { status: 400 })
    }

    const flowId = randomUUID()
    const keypair = createServerSolflareKeypair()

    await createSolflareDeeplinkSession({
      flow_id: flowId,
      payment_id: paymentId,
      intent_id: intentId,
      selected_asset: selectedAsset,
      dapp_public_key: keypair.publicKey,
      dapp_secret_key: keypair.secretKey,
    })

    const origin = req.headers.get("origin") || new URL(req.url).origin
    const redirect = new URL("/pay", origin)
    redirect.searchParams.set("intent", intentId)
    redirect.searchParams.set("solflare_action", "connect_callback")
    redirect.searchParams.set("solflare_flow", flowId)

    const connectUrl = buildServerConnectUrl({
      redirectLink: redirect.toString(),
      appUrl: origin,
      dappPublicKey: keypair.publicKey,
    })

    console.log(
      "[SOLFLARE DEBUG]",
      "solflare-start-created",
      JSON.stringify({
        flowIdPrefix: flowId.slice(0, 8),
        paymentId,
        intentId,
        selectedAsset,
      }),
    )

    return NextResponse.json({ connectUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Solflare flow"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}