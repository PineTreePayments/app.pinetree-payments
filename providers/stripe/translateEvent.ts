import type { StripeEvent, StripeTranslatedEvent } from "./types"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function getPaymentId(paymentIntent: Record<string, unknown>): string {
  const metadata = asRecord(paymentIntent.metadata) || {}

  return String(
    metadata.paymentId ||
    metadata.pinetree_payment_id ||
    paymentIntent.paymentId ||
    ""
  ).trim()
}

export function translateEvent(payload: unknown): StripeTranslatedEvent | null {
  const event = asRecord(payload) as StripeEvent | null
  if (!event) return null

  const providerEvent = String(event.type || "").trim()
  const paymentIntent = asRecord(event.data?.object) || {}
  const providerReference = String(paymentIntent.id || "").trim()
  const paymentId = getPaymentId(paymentIntent)

  if (!providerEvent || !providerReference) return null

  const base = {
    provider: "stripe" as const,
    providerReference,
    providerEvent,
    paymentId
  }

  switch (providerEvent) {
    case "payment_intent.created":
      return { ...base, event: "payment.created" }
    case "payment_intent.processing":
      return { ...base, event: "payment.processing" }
    case "payment_intent.succeeded":
      return { ...base, event: "payment.confirmed" }
    case "payment_intent.payment_failed":
      return { ...base, event: "payment.failed" }
    case "payment_intent.canceled":
      return { ...base, event: "payment.canceled" }
    default:
      return null
  }
}
