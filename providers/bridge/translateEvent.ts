/**
 * Bridge (by Stripe) - webhook event translation.
 *
 * Bridge delivers merchant/provider CONNECTION events (`customer`, `kyc_link`,
 * `external_account`) and money-movement events (`liquidation_address.drain`).
 * Neither is a PineTree payment event, so both are translated into a Bridge
 * connection-event envelope rather than PineTree's payment-event envelope:
 * emitting a `payment.*` event for a KYB status change or a bank payout would
 * corrupt the canonical payment state machine.
 *
 * A drain is WITHDRAWAL evidence. It is applied to the withdrawal lifecycle by
 * PineTree Engine, which remains the only transition authority.
 *
 * Categories PineTree does not support translate to null. An unrecognized value
 * is never guessed into a supported one.
 */

import type { BridgeWebhookEvent } from "./types"

/**
 * Event categories PineTree ingests today, exactly as Bridge's
 * `WebhookEventCategory` enum spells them.
 */
export const SUPPORTED_BRIDGE_EVENT_CATEGORIES = [
  "customer",
  "kyc_link",
  "external_account",
  "liquidation_address.drain",
] as const
export type BridgeEventCategory = (typeof SUPPORTED_BRIDGE_EVENT_CATEGORIES)[number]

/** Categories that change KYB / connection state rather than money movement. */
export const BRIDGE_CONNECTION_EVENT_CATEGORIES = [
  "customer",
  "kyc_link",
  "external_account",
] as const

export function isBridgeDrainEventCategory(category: BridgeEventCategory): boolean {
  return category === "liquidation_address.drain"
}

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
  /** Set for `external_account` deliveries. */
  externalAccountId: string | null
  /** Set for `liquidation_address.drain` deliveries. */
  liquidationAddressId: string | null
  drainId: string | null
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

type BridgeEventIdentifiers = {
  customerId: string | null
  kycLinkId: string | null
  externalAccountId: string | null
  liquidationAddressId: string | null
  drainId: string | null
}

const EMPTY_IDENTIFIERS: BridgeEventIdentifiers = {
  customerId: null,
  kycLinkId: null,
  externalAccountId: null,
  liquidationAddressId: null,
  drainId: null,
}

/**
 * Resolve the Bridge identifiers this event refers to.
 *
 * The envelope's `event_object_id` means a different resource per category: a
 * `customer` event's object id IS the customer id, a `kyc_link` event's is the
 * link id, an `external_account` event's is the bank destination, and a
 * `liquidation_address.drain` event's is the drain. Every category also reads
 * the nested object so the Engine can resolve the owning merchant from whatever
 * identifier PineTree already has stored.
 */
function extractIdentifiers(
  category: BridgeEventCategory,
  event: BridgeWebhookEvent
): BridgeEventIdentifiers {
  const object = isRecord(event.event_object) ? event.event_object : {}
  const objectId = trimmedOrNull(event.event_object_id) || trimmedOrNull(object.id)
  const customerId = trimmedOrNull(object.customer_id)

  if (category === "customer") {
    return {
      ...EMPTY_IDENTIFIERS,
      customerId: objectId || customerId,
      kycLinkId: trimmedOrNull(object.kyc_link_id),
    }
  }

  if (category === "kyc_link") {
    return { ...EMPTY_IDENTIFIERS, customerId, kycLinkId: objectId }
  }

  if (category === "external_account") {
    return { ...EMPTY_IDENTIFIERS, customerId, externalAccountId: objectId }
  }

  return {
    ...EMPTY_IDENTIFIERS,
    customerId,
    liquidationAddressId: trimmedOrNull(object.liquidation_address_id),
    drainId: objectId,
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
    // A drain reports progress in `state`, not `status`.
    trimmedOrNull(object.state) ||
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
  const identifiers = extractIdentifiers(category, event)
  const occurred = parseOccurredAt(event.event_created_at)

  return {
    eventId,
    category,
    type,
    // Bridge names transitions `<category>.updated.status_transitioned`.
    statusTransition: type.toLowerCase().includes("status_transitioned"),
    ...identifiers,
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
