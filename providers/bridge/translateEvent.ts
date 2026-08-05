/**
 * Bridge (by Stripe) - webhook event translation.
 *
 * Bridge phase 1 delivers merchant/provider CONNECTION events (customer and
 * kyc_link), not payment events. They are therefore translated into a
 * Bridge-connection event envelope rather than PineTree's payment-event
 * envelope: emitting a `payment.*` event for a KYB status change would corrupt
 * the canonical payment state machine.
 *
 * Categories PineTree does not yet support translate to null. An unrecognized
 * value is never guessed into a supported one.
 */

import type { BridgeWebhookEvent } from "./types"

/** Event categories PineTree ingests today. */
export const SUPPORTED_BRIDGE_EVENT_CATEGORIES = ["customer", "kyc_link"] as const
export type BridgeEventCategory = (typeof SUPPORTED_BRIDGE_EVENT_CATEGORIES)[number]

/**
 * PineTree's normalized Bridge connection event.
 *
 * It carries identifiers and normalized status only - never the KYB payload.
 * `occurredAtMs` is what orders events, so a delayed delivery can never
 * overwrite newer state.
 */
export type NormalizedBridgeConnectionEvent = {
  eventId: string
  category: BridgeEventCategory
  type: string
  /** True when the event type describes a status transition. */
  statusTransition: boolean
  customerId: string | null
  kycLinkId: string | null
  /** Bridge's reported object status, retained for diagnostics. */
  objectStatus: string | null
  occurredAt: string | null
  occurredAtMs: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function trimmedOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function parseOccurredAt(value: unknown): { iso: string | null; ms: number | null } {
  const raw = trimmedOrNull(value)
  if (!raw) return { iso: null, ms: null }
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return { iso: raw, ms: null }
  return { iso: new Date(parsed).toISOString(), ms: parsed }
}

function normalizeCategory(value: unknown): BridgeEventCategory | null {
  const normalized = trimmedOrNull(value)?.toLowerCase()
  if (!normalized) return null
  return (SUPPORTED_BRIDGE_EVENT_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as BridgeEventCategory)
    : null
}

/**
 * Resolve the customer and KYC-link identifiers this event refers to.
 *
 * A `customer` event's object id IS the customer id; a `kyc_link` event's
 * object id is the link id and its object may carry the customer id. Both are
 * read from the event object where present so the engine can resolve the
 * owning merchant either way.
 */
function extractIdentifiers(
  category: BridgeEventCategory,
  event: BridgeWebhookEvent
): { customerId: string | null; kycLinkId: string | null } {
  const object = isRecord(event.event_object) ? event.event_object : {}
  const objectId = trimmedOrNull(event.event_object_id) || trimmedOrNull(object.id)

  if (category === "customer") {
    return {
      customerId: objectId || trimmedOrNull(object.customer_id),
      kycLinkId: trimmedOrNull(object.kyc_link_id),
    }
  }

  return {
    customerId: trimmedOrNull(object.customer_id),
    kycLinkId: objectId,
  }
}

/**
 * Bridge's object status lives on the envelope for some deliveries and inside
 * the object for others. Both are checked, preferring the envelope.
 */
function extractObjectStatus(event: BridgeWebhookEvent): string | null {
  const object = isRecord(event.event_object) ? event.event_object : {}
  return (
    trimmedOrNull(event.event_object_status) ||
    trimmedOrNull(object.status) ||
    trimmedOrNull(object.kyc_status)
  )
}

/**
 * Translate a verified Bridge webhook payload.
 *
 * Returns null for an unsupported category, a missing event id, or a payload
 * that is not a Bridge event envelope. A null result means "acknowledge and
 * do not change state" - never "treat as approved".
 */
export function translateBridgeEvent(payload: unknown): NormalizedBridgeConnectionEvent | null {
  if (!isRecord(payload)) return null
  const event = payload as BridgeWebhookEvent

  const eventId = trimmedOrNull(event.event_id)
  if (!eventId) return null

  const category = normalizeCategory(event.event_category)
  if (!category) return null

  const type = trimmedOrNull(event.event_type) || `${category}.updated`
  const { customerId, kycLinkId } = extractIdentifiers(category, event)
  const occurred = parseOccurredAt(event.event_created_at)

  return {
    eventId,
    category,
    type,
    // Bridge names transitions `<category>.updated.status_transitioned`.
    statusTransition: type.toLowerCase().includes("status_transitioned"),
    customerId,
    kycLinkId,
    objectStatus: extractObjectStatus(event),
    occurredAt: occurred.iso,
    occurredAtMs: occurred.ms,
  }
}

/**
 * Extract the Bridge objects a verified event carries so the engine can
 * normalize state without an extra provider round trip.
 *
 * The event object is only used as a status SIGNAL. Approval is always
 * confirmed against Bridge state - never against a browser redirect.
 */
export function extractBridgeEventObject(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  const object = (payload as BridgeWebhookEvent).event_object
  return isRecord(object) ? object : null
}
