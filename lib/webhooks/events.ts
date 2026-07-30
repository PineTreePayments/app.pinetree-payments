export const WEBHOOK_SCHEMA = "payments-v1"
export const WEBHOOK_SCHEMA_HEADER = "PineTree-Event-Schema"
export const LEGACY_SCHEMA_HEADER = "PineTree-Webhook-Version"

export const SUPPORTED_WEBHOOK_EVENTS = [
  "payment.created",
  "payment.pending",
  "payment.processing",
  "payment.confirmed",
  "payment.failed",
  "payment.expired",
  "payment.canceled",
  "payment.incomplete",
  "payment.refunded",
  "checkout.session.created",
  "checkout.session.processing",
  "checkout.session.completed",
  "checkout.session.failed",
  "checkout.session.expired",
  "checkout.session.canceled",
  "payment_link.created",
  "payment_link.disabled",
  "payment_link.expired",
] as const

export const LEGACY_WEBHOOK_EVENTS = [
  "checkout.session.paid",
  "payment.cancelled",
] as const

export type CanonicalWebhookEvent = typeof SUPPORTED_WEBHOOK_EVENTS[number]
export type LegacyWebhookEvent = typeof LEGACY_WEBHOOK_EVENTS[number]
export type WebhookEvent = CanonicalWebhookEvent | LegacyWebhookEvent

export function normalizeWebhookEventType(event: string): CanonicalWebhookEvent | null {
  if (event === "checkout.session.paid") return "checkout.session.completed"
  if (event === "payment.cancelled") return "payment.canceled"
  return (SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(event)
    ? event as CanonicalWebhookEvent
    : null
}

export function webhookSubscriptionMatches(events: readonly WebhookEvent[], event: WebhookEvent) {
  const canonicalEvent = normalizeWebhookEventType(event)
  if (!canonicalEvent) return false
  return events.some((configuredEvent) => normalizeWebhookEventType(configuredEvent) === canonicalEvent)
}
