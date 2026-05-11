import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    let payload: unknown

    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch {
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
    console.error("[webhooks/lightning] failed", error)
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 })
  }
}
