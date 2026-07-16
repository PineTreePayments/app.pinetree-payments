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

/**
 * Extracts the PaymentIntent reference and action state from a
 * terminal.reader.* event payload (data.object is a Terminal Reader whose
 * `action.process_payment_intent.payment_intent` links back to the intent).
 */
function translateTerminalReaderEvent(
  providerEvent: string,
  reader: Record<string, unknown>
): StripeTranslatedEvent | null {
  const action = asRecord(reader.action)
  if (!action || String(action.type || "") !== "process_payment_intent") return null

  const processPaymentIntent = asRecord(action.process_payment_intent) || {}
  const rawIntent = processPaymentIntent.payment_intent
  const providerReference = typeof rawIntent === "string"
    ? rawIntent.trim()
    : String(asRecord(rawIntent)?.id || "").trim()

  if (!providerReference) return null

  const base = {
    provider: "stripe" as const,
    providerReference,
    providerEvent,
    paymentId: ""
  }

  const actionStatus = String(action.status || "").toLowerCase()

  if (providerEvent === "terminal.reader.action_failed" || actionStatus === "failed") {
    return { ...base, event: "payment.failed" }
  }

  // action_succeeded means the card was collected and the intent confirmed;
  // final CONFIRMED still comes from payment_intent.succeeded, so both
  // success and in-progress updates advance the payment to processing only.
  return { ...base, event: "payment.processing" }
}

export function translateEvent(payload: unknown): StripeTranslatedEvent | null {
  const event = asRecord(payload) as StripeEvent | null
  if (!event) return null

  const providerEvent = String(event.type || "").trim()
  if (!providerEvent) return null

  const dataObject = asRecord(event.data?.object) || {}

  // Server-driven Terminal reader events (validated against stripe@22 types:
  // terminal.reader.action_succeeded / action_failed / action_updated).
  if (providerEvent.startsWith("terminal.reader.")) {
    if (
      providerEvent === "terminal.reader.action_succeeded" ||
      providerEvent === "terminal.reader.action_failed" ||
      providerEvent === "terminal.reader.action_updated"
    ) {
      return translateTerminalReaderEvent(providerEvent, dataObject)
    }
    return null
  }

  const paymentIntent = dataObject
  const providerReference = String(paymentIntent.id || "").trim()
  const paymentId = getPaymentId(paymentIntent)

  if (!providerReference) return null

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
