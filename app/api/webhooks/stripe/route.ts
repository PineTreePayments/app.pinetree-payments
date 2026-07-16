import { NextRequest, NextResponse } from "next/server"
import { processWebhook } from "@/engine/eventProcessor"
import { loadProviders } from "@/engine/loadProviders"
import { syncStripeConnectAccountByProviderAccountId } from "@/engine/stripeConnect"

export async function GET() {
  return NextResponse.json({ ok: true, provider: "stripe", endpoint: "stripe" })
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
      provider: "stripe",
      payload,
      headers: Object.fromEntries(req.headers),
      rawBody
    })

    const event = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
    if (event.type === "account.updated") {
      const account = event.account || (event.data as { object?: { id?: unknown } } | undefined)?.object?.id
      await syncStripeConnectAccountByProviderAccountId(String(account || ""))
    }

    return NextResponse.json({ received: true, provider: "stripe" })
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

    console.error("[webhooks/stripe] processing error", {
      error: message,
      bodyLength: rawBody.length
    })
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
