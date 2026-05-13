import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getMerchantWebhook, upsertMerchantWebhook, type WebhookEvent } from "@/database/merchantWebhooks"
import { generateWebhookSecret } from "@/engine/webhookDelivery"

const VALID_EVENTS: WebhookEvent[] = [
  "payment.confirmed",
  "payment.failed",
  "payment.incomplete",
  "checkout.session.created",
]

type UpsertBody = {
  url: string
  events?: WebhookEvent[]
  regenerateSecret?: boolean
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const config = await getMerchantWebhook(merchantId)
    return NextResponse.json({ webhook: config })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch webhook config" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as UpsertBody

    const url = String(body.url || "").trim()
    if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 })

    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return NextResponse.json({ error: "url must be http or https" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: "url must be a valid URL" }, { status: 400 })
    }

    const requestedEvents = Array.isArray(body.events) ? body.events : VALID_EVENTS
    const events = requestedEvents.filter((e) =>
      VALID_EVENTS.includes(e as WebhookEvent)
    ) as WebhookEvent[]

    const existing = await getMerchantWebhook(merchantId)
    const secret =
      body.regenerateSecret || !existing?.secret
        ? generateWebhookSecret()
        : existing.secret

    const webhook = await upsertMerchantWebhook({ merchantId, url, secret, events })
    return NextResponse.json({ webhook }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save webhook config" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
