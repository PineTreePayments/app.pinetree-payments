import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"

export async function POST(req: NextRequest) {
  try {
    const provider = String(req.headers.get("x-provider") || "").trim().toLowerCase()
    if (!provider) {
      return NextResponse.json(
        { error: "Missing x-provider header" },
        { status: 400 }
      )
    }

    const rawBody = await req.text()
    let payload: unknown = null

    try {
      payload = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      )
    }

    const headers = Object.fromEntries(req.headers)

    await processWebhook({
      provider,
      payload,
      headers,
      rawBody
    })

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("Webhook error:", err)
    return NextResponse.json(
      { error: "Webhook failed" },
      { status: 500 }
    )
  }
}