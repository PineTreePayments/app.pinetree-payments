import type {
  WebhookDeliveryStatus,
  WebhookEvent,
} from "@/database/merchantWebhooks"
import { V1ApiError } from "./errors"

const DELIVERY_STATUSES: WebhookDeliveryStatus[] = ["pending", "delivered", "failed"]
const EVENT_TYPES: WebhookEvent[] = [
  "payment.confirmed",
  "payment.failed",
  "payment.incomplete",
  "checkout.session.created",
  "checkout.session.processing",
  "checkout.session.paid",
  "checkout.session.failed",
  "checkout.session.expired",
  "checkout.session.canceled",
]

export function parseWebhookDeliveryListQuery(url: string) {
  const params = new URL(url).searchParams
  const limit = Number(params.get("limit") || 20)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new V1ApiError({
      status: 400,
      type: "invalid_request_error",
      code: "invalid_filter",
      message: "limit must be an integer between 1 and 100.",
    })
  }

  const statusValue = params.get("status")
  if (statusValue && !DELIVERY_STATUSES.includes(statusValue as WebhookDeliveryStatus)) {
    throw new V1ApiError({
      status: 400,
      type: "invalid_request_error",
      code: "invalid_filter",
      message: "status must be pending, delivered, or failed.",
    })
  }

  const eventTypeValue = params.get("eventType")
  if (eventTypeValue && !EVENT_TYPES.includes(eventTypeValue as WebhookEvent)) {
    throw new V1ApiError({
      status: 400,
      type: "invalid_request_error",
      code: "invalid_filter",
      message: "eventType is not supported.",
    })
  }

  const rawCursor = params.get("cursor")
  let cursor: { createdAt: string; id: string } | undefined
  if (rawCursor) {
    try {
      const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"))
      if (!parsed.createdAt || !parsed.id || Number.isNaN(new Date(parsed.createdAt).getTime())) {
        throw new Error("invalid")
      }
      cursor = {
        createdAt: new Date(parsed.createdAt).toISOString(),
        id: String(parsed.id),
      }
    } catch {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_cursor",
        message: "The pagination cursor is invalid.",
      })
    }
  }

  return {
    limit,
    cursor,
    status: statusValue as WebhookDeliveryStatus | undefined,
    eventType: eventTypeValue as WebhookEvent | undefined,
  }
}
