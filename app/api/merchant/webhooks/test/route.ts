import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { testWebhookDelivery } from "@/engine/webhookDelivery"
import { normalizeWebhookEventType, type WebhookEvent } from "@/database/merchantWebhooks"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req, "webhooks:write")

    const body = (await req.json()) as { event?: string }
    const event: WebhookEvent = normalizeWebhookEventType(String(body.event || "")) ?? "payment.confirmed"

    const result = await testWebhookDelivery(merchantId, event)

    // Always return 200 — the result object carries success/error detail.
    // A non-2xx from the merchant's endpoint is a delivery failure, not a
    // PineTree API error.
    return NextResponse.json(result)
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send test event" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
