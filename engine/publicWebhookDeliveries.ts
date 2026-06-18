import {
  listWebhookDeliveriesForPublicApi,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEvent,
} from "@/database/merchantWebhooks"

export type PublicWebhookDelivery = {
  id: string
  object: "webhook.delivery"
  eventType: WebhookEvent
  status: WebhookDeliveryStatus
  attemptCount: number
  nextAttemptAt: string | null
  lastAttemptAt: string | null
  lastStatusCode: number | null
  lastError: string | null
  deliveredAt: string | null
  deadLetteredAt: string | null
  createdAt: string
}

export function normalizePublicWebhookDelivery(
  delivery: WebhookDelivery
): PublicWebhookDelivery {
  return {
    id: delivery.id,
    object: "webhook.delivery" as const,
    eventType: delivery.event,
    status: delivery.status,
    attemptCount: Number(delivery.attempt_count || 0),
    nextAttemptAt: delivery.next_attempt_at,
    lastAttemptAt: delivery.last_attempt_at,
    lastStatusCode: delivery.last_status_code ?? delivery.response_status,
    lastError: delivery.last_error,
    deliveredAt: delivery.delivered_at,
    deadLetteredAt: delivery.dead_lettered_at,
    createdAt: delivery.created_at,
  }
}

export async function listPublicWebhookDeliveries(input: {
  merchantId: string
  limit: number
  cursor?: { createdAt: string; id: string }
  status?: WebhookDeliveryStatus
  eventType?: WebhookEvent
}) {
  const rows = await listWebhookDeliveriesForPublicApi({
    ...input,
    limit: input.limit + 1,
  })
  const hasMore = rows.length > input.limit
  const page = rows.slice(0, input.limit)
  const last = page[page.length - 1]
  return {
    data: page.map(normalizePublicWebhookDelivery),
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.created_at, id: last.id })
          ).toString("base64url")
        : null,
  }
}
