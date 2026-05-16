import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"

export async function POST(req: NextRequest) {
  let rawBody = ""
  try {
    rawBody = await req.text()
    let payload: unknown

    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      console.warn("[webhooks/lightning] malformed JSON body rejected")
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    await processWebhook({
      provider: "lightning",
      payload,
      headers: Object.fromEntries(req.headers),
      rawBody
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed"

    if (message === "Webhook verification failed") {
      console.warn("[webhooks/lightning] signature verification failed", {
        bodyLength: rawBody.length,
        hasSignatureHeader: Boolean(req.headers.get("webhook-signature")),
      })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.error("[webhooks/lightning] processing error", { error: message })
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 })
  }
}
