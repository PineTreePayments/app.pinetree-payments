import type { Shift4TranslatedEvent } from "./types"

export function translateEvent(payload: unknown): Shift4TranslatedEvent | null {
  const providerEvent = getProviderEvent(payload)
  const status = getProviderStatus(payload)
  const normalized = normalizeEventName(providerEvent || status)
  const paymentId = getPaymentId(payload)
  const providerReference = getProviderReference(payload)
  const event = mapShift4Event(normalized)

  if (!event) return null

  return {
    provider: "shift4",
    paymentId,
    providerReference,
    providerEvent: providerEvent || status || undefined,
    event,
    raw: payload
  }
}

export function mapShift4Event(value: string):
  | "payment.created"
  | "payment.pending"
  | "payment.processing"
  | "payment.confirmed"
  | "payment.failed"
  | "payment.incomplete"
  | null {
  const normalized = normalizeEventName(value)

  if (normalized === "created") return "payment.created"
  if (normalized === "pending") return "payment.pending"
  if (normalized === "charge_pending") return "payment.pending"
  // Authorized/approved card states mean the card was accepted or held, not
  // necessarily captured or settled. Keep PineTree in PROCESSING for these.
  if (normalized === "authorized" || normalized === "approved") return "payment.processing"
  if (normalized === "charge_updated") return "payment.processing"
  // Captured/settled-style events are the only initial final states mapped to
  // CONFIRMED. If Shift4 later distinguishes capture from settlement, PineTree
  // should choose the final state required for merchant fulfillment explicitly.
  if (
    normalized === "captured" ||
    normalized === "settled" ||
    normalized === "completed" ||
    normalized === "paid" ||
    normalized === "successful" ||
    normalized === "charge_succeeded" ||
    normalized === "charge_captured"
  ) {
    return "payment.confirmed"
  }
  if (
    normalized === "declined" ||
    normalized === "failed" ||
    normalized === "voided" ||
    normalized === "charge_failed"
  ) {
    return "payment.failed"
  }
  if (normalized === "canceled" || normalized === "cancelled" || normalized === "expired") {
    return "payment.incomplete"
  }
  // Refund events are post-confirmation accounting events in this first pass.
  // Returning null prevents a refund-only webhook from confirming a new payment.
  if (normalized === "refunded" || normalized === "charge_refunded") return null

  return null
}

function normalizeEventName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^payment[._-]/, "")
}

function getPaymentId(payload: unknown): string {
  return (
    readString(payload, ["metadata", "paymentId"]) ||
    readString(payload, ["data", "metadata", "paymentId"]) ||
    readString(payload, ["data", "object", "metadata", "paymentId"]) ||
    readString(payload, ["data", "metadata", "payment_id"]) ||
    readString(payload, ["data", "object", "metadata", "payment_id"]) ||
    readString(payload, ["payment", "metadata", "paymentId"]) ||
    readString(payload, ["payment_id"]) ||
    ""
  )
}

function getProviderReference(payload: unknown): string | undefined {
  return (
    readString(payload, ["data", "object", "id"]) ||
    readString(payload, ["data", "id"]) ||
    readString(payload, ["data", "chargeId"]) ||
    readString(payload, ["payment", "id"]) ||
    readString(payload, ["id"]) ||
    undefined
  )
}

function getProviderEvent(payload: unknown): string {
  return (
    readString(payload, ["event", "type"]) ||
    readString(payload, ["type"]) ||
    readString(payload, ["event_type"])
  )
}

function getProviderStatus(payload: unknown): string {
  return (
    readString(payload, ["data", "object", "status"]) ||
    readString(payload, ["data", "status"]) ||
    readString(payload, ["payment", "status"]) ||
    readString(payload, ["status"])
  )
}

function readString(value: unknown, path: string[]): string {
  let cursor: unknown = value
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return ""
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return String(cursor || "").trim()
}
