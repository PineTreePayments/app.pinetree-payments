import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"
import { loadProviders } from "@/engine/loadProviders"

export async function GET() {
  return NextResponse.json({ ok: true, provider: "shift4", endpoint: "shift4" })
}

export async function POST(req: NextRequest) {
  let rawBody = ""

  try {
    rawBody = await req.text()
    let payload: unknown

    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    await loadProviders()
    await processWebhook({
      provider: "shift4",
      payload,
      headers: Object.fromEntries(req.headers),
      rawBody
    })

    return NextResponse.json({ received: true, provider: "shift4" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed"

    if (message === "Webhook verification failed") {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
    }

    if (
      message.startsWith("Unknown provider") ||
      message.startsWith("Provider not registered")
    ) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 })
    }

    console.error("[webhooks/shift4] processing error", {
      error: message,
      bodyLength: rawBody.length
    })
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
