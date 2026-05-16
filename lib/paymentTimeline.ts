/**
 * Payment Timeline
 *
 * Normalized debug representation of a payment's lifecycle across all rails.
 * Debug-only — not used in payment creation or confirmation logic.
 *
 * Architecture: UI → API → ENGINE → PROVIDERS → DATABASE (read-only helper)
 */

export type PaymentRailKind = "base" | "solana" | "lightning" | "unknown"

export type TimelineEventKind =
  // Lifecycle
  | "payment_created"
  | "wallet_selected"
  | "wallet_opened"
  | "deep_link_generated"
  | "tx_requested"
  | "tx_submitted"
  | "detect_started"
  | "detect_completed"
  | "watcher_started"
  | "watcher_completed"
  | "webhook_received"
  | "confirmation_received"
  | "payment_confirmed"
  // Recovery
  | "retry_requested"
  | "switch_method"
  | "wallet_returned_without_payment"
  // Errors
  | "user_rejected"
  | "timeout"
  | "duplicate_blocked"
  | "webhook_verification_failed"
  // Fallback
  | "app_store_fallback_triggered"
  | "provider_event_translated"

export type TimelineEntry = {
  event: TimelineEventKind | string
  rail: PaymentRailKind
  timestamp: string
  paymentId: string
  metadata: Record<string, unknown>
  source: "client" | "server"
}

export type PaymentTimeline = {
  paymentId: string
  rail: PaymentRailKind
  entries: TimelineEntry[]
  firstEventAt: string | null
  lastEventAt: string | null
  confirmedAt: string | null
  webhookReceivedAt: string | null
  detectCalledAt: string | null
}

function inferRail(network?: string | null): PaymentRailKind {
  const n = String(network || "").toLowerCase()
  if (n === "base" || n === "base_pay") return "base"
  if (n === "solana") return "solana"
  if (n === "bitcoin_lightning" || n === "lightning") return "lightning"
  return "unknown"
}

type RawPaymentEvent = {
  id?: string
  payment_id?: string
  event_type?: string
  provider_event?: string | null
  created_at?: string | null
  raw_payload?: unknown
}

type RawPayment = {
  id: string
  network?: string | null
  status?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Build a normalized PaymentTimeline from raw DB records.
 *
 * rawPayment: the payments row
 * rawEvents:  rows from payment_events for this payment_id, ordered by created_at ASC
 */
export function buildPaymentTimeline(
  rawPayment: RawPayment,
  rawEvents: RawPaymentEvent[],
): PaymentTimeline {
  const rail = inferRail(rawPayment.network)
  const paymentId = rawPayment.id

  const entries: TimelineEntry[] = []

  // Synthesize payment_created from the payment row's own created_at
  if (rawPayment.created_at) {
    entries.push({
      event: "payment_created",
      rail,
      timestamp: rawPayment.created_at,
      paymentId,
      metadata: { status: rawPayment.status, network: rawPayment.network },
      source: "server",
    })
  }

  // Map payment_events rows to timeline entries
  for (const evt of rawEvents) {
    const eventType = String(evt.event_type || "").trim()
    const timestamp = String(evt.created_at || "").trim()
    if (!eventType || !timestamp) continue

    const kind = mapEventTypeToKind(eventType)
    const payload = evt.raw_payload as Record<string, unknown> | undefined

    entries.push({
      event: kind,
      rail,
      timestamp,
      paymentId,
      metadata: {
        providerEvent: evt.provider_event || null,
        ...(payload && typeof payload === "object" && !Array.isArray(payload)
          ? sanitizeMetadata(payload)
          : {}),
      },
      source: "server",
    })
  }

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const firstEventAt = entries[0]?.timestamp ?? null
  const lastEventAt = entries[entries.length - 1]?.timestamp ?? null
  const confirmedEntry = entries.find((e) => e.event === "confirmation_received" || e.event === "payment_confirmed")
  const webhookEntry = entries.find((e) => e.event === "webhook_received")
  const detectEntry = entries.find((e) => e.event === "detect_started")

  return {
    paymentId,
    rail,
    entries,
    firstEventAt,
    lastEventAt,
    confirmedAt: confirmedEntry?.timestamp ?? null,
    webhookReceivedAt: webhookEntry?.timestamp ?? null,
    detectCalledAt: detectEntry?.timestamp ?? null,
  }
}

function mapEventTypeToKind(eventType: string): TimelineEventKind | string {
  const map: Record<string, TimelineEventKind> = {
    "payment.created": "payment_created",
    "payment.pending": "detect_started",
    "payment.processing": "watcher_started",
    "payment.confirmed": "payment_confirmed",
    "payment.failed": "user_rejected",
  }
  return map[eventType] ?? eventType
}

// Strip fields that contain sensitive or overly-verbose data.
const BLOCKED_KEYS = new Set([
  "signature",
  "privateKey",
  "private_key",
  "rawBody",
  "raw_body",
  "authorization",
  "secret",
  "key",
  "token",
  "password",
])

function sanitizeMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCKED_KEYS.has(k)) continue
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = sanitizeMetadata(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}
