import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"
import { loadProviders } from "@/engine/loadProviders"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"

export async function POST(req: NextRequest) {
  let rawBody = ""

  try {
    rawBody = await req.text()
    let payload: unknown

    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      console.warn("[webhooks/speed] malformed JSON body rejected")
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    await loadProviders()
    await processWebhook({
      provider: SPEED_PROVIDER_NAME,
      payload,
      headers: Object.fromEntries(req.headers),
      rawBody
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed"

    if (message === "Webhook verification failed") {
      console.warn("[webhooks/speed] signature verification failed", {
        bodyLength: rawBody.length,
        hasSignatureHeader: Boolean(req.headers.get("webhook-signature")),
        hasTimestampHeader: Boolean(req.headers.get("webhook-timestamp")),
        hasWebhookIdHeader: Boolean(req.headers.get("webhook-id"))
      })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.error("[webhooks/speed] processing error", { error: message })
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 })
  }
}
