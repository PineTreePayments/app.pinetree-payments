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
    const message = err instanceof Error ? err.message : "Webhook processing failed"

    // Return semantically correct status codes so callers know why delivery failed.
    // The engine throws with known messages for auth/registry failures.
    if (
      message === "Webhook verification failed" ||
      message.startsWith("Invalid") ||
      message.startsWith("Signature")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (
      message.startsWith("Unknown provider") ||
      message.startsWith("Provider not registered")
    ) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 })
    }

    console.error("[webhook:provider] processing error", { provider: "unknown", message })
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}