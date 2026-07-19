import {
  getMerchantWebhook,
  getMerchantWebhookById,
  getWebhookDeliveryById,
  insertWebhookDelivery,
  listRetryEligibleWebhookDeliveries,
  updateWebhookDeliveryAttempt,
  type WebhookDelivery,
  type MerchantWebhook,
} from "@/database/merchantWebhooks"
import {
  WEBHOOK_SCHEMA,
  WEBHOOK_SCHEMA_HEADER,
  LEGACY_SCHEMA_HEADER,
  normalizeWebhookEventType,
  webhookSubscriptionMatches,
  type CanonicalWebhookEvent,
  type WebhookEvent,
} from "@/lib/webhooks/events"
import type { PublicCheckoutSession } from "./publicCheckoutSessions"
import { assertSafeWebhookUrl } from "@/lib/webhooks/outboundUrl"

const WEBHOOK_TIMEOUT_MS = 10_000
export const V1_WEBHOOK_VERSION = WEBHOOK_SCHEMA

export type WebhookPaymentData = {
  paymentId: string
  merchantId: string
  amount: number
  currency: string
  status: string
  network?: string
  reference?: string
  checkoutLinkId?: string
  confirmedAt?: string
  metadata?: Record<string, unknown>
}

type PineTreeWebhookEnvelope<T extends Record<string, unknown>> = {
  eventId: string
  object: "event"
  type: CanonicalWebhookEvent
  schema: typeof V1_WEBHOOK_VERSION
  createdAt: string
  livemode: boolean
  data: {
    object: T
  }
}

function generateEventId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `evt_${hex}`
}

function resolveLivemode(metadata?: Record<string, unknown>, override?: boolean) {
  if (typeof override === "boolean") return override
  if (metadata?.test === true) return false
  const configured = process.env.PINETREE_LIVEMODE ?? process.env.NEXT_PUBLIC_PINETREE_LIVEMODE
  if (configured) return configured.toLowerCase() === "true"
  return process.env.NODE_ENV === "production"
}

function buildWebhookEnvelope<T extends Record<string, unknown>>(
  event: WebhookEvent,
  object: T,
  input?: { createdAt?: string; livemode?: boolean; metadata?: Record<string, unknown> }
): PineTreeWebhookEnvelope<T> {
  const canonicalEvent = normalizeWebhookEventType(event)
  if (!canonicalEvent) throw new Error(`Unsupported webhook event: ${event}`)
  return {
    eventId: generateEventId(),
    object: "event",
    type: canonicalEvent,
    schema: V1_WEBHOOK_VERSION,
    createdAt: input?.createdAt ?? new Date().toISOString(),
    livemode: resolveLivemode(input?.metadata, input?.livemode),
    data: { object },
  }
}

function buildPaymentWebhookEvent(
  event: WebhookEvent,
  data: WebhookPaymentData,
  options?: { livemode?: boolean }
): PineTreeWebhookEnvelope<Record<string, unknown>> {
  return buildWebhookEnvelope(
    event,
    {
      id: data.paymentId,
      object: "payment",
      merchantId: data.merchantId,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      network: data.network ?? null,
      reference: data.reference ?? null,
      checkoutLinkId: data.checkoutLinkId ?? null,
      confirmedAt: data.confirmedAt ?? null,
      metadata: data.metadata ?? {},
    },
    { metadata: data.metadata, livemode: options?.livemode }
  )
}

function buildTestWebhookEvent(event: WebhookEvent, merchantId: string, data: WebhookPaymentData) {
  if (event.startsWith("checkout.session.")) {
    return buildWebhookEnvelope(
      event,
      {
        id: `cs_test_${data.paymentId.slice(5)}`,
        object: "checkout.session",
        status: event === "checkout.session.completed" || event === "checkout.session.paid" ? "paid"
          : event === "checkout.session.failed" ? "failed"
          : event === "checkout.session.expired" ? "expired"
          : event === "checkout.session.canceled" ? "canceled"
          : event === "checkout.session.processing" ? "processing"
          : "open",
        amount: data.amount,
        currency: data.currency,
        reference: data.reference ?? null,
        customer: { email: null },
        metadata: data.metadata ?? {},
        checkoutUrl: "https://checkout.pinetree-payments.com/test",
        paymentId: data.paymentId,
        supportedRails: [],
        successUrl: null,
        cancelUrl: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        merchantId,
      },
      { livemode: false }
    )
  }

  if (event.startsWith("payment_link.")) {
    return buildWebhookEnvelope(
      event,
      {
        id: `plink_test_${data.paymentId.slice(5)}`,
        object: "payment_link",
        status: event === "payment_link.disabled" ? "disabled"
          : event === "payment_link.expired" ? "expired"
          : "active",
        amount: data.amount,
        currency: data.currency,
        reference: data.reference ?? null,
        metadata: data.metadata ?? {},
        merchantId,
      },
      { livemode: false }
    )
  }

  return buildPaymentWebhookEvent(event, data, { livemode: false })
}

async function signPayload(payload: string, secret: string, timestamp: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestamp}.${payload}`).buffer as ArrayBuffer
  )
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function isV1EventPayload(payload: Record<string, unknown>) {
  const data = payload.data
  return Boolean(
    payload.eventId &&
    payload.object === "event" &&
    payload.type &&
    payload.createdAt &&
    typeof payload.livemode === "boolean" &&
    data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).object
  )
}

function getPayloadEventId(payload: Record<string, unknown>) {
  const value = payload.eventId
  return typeof value === "string" ? value : generateEventId()
}

function normalizeStoredPayload(event: WebhookEvent, payload: Record<string, unknown>) {
  const canonicalEvent = normalizeWebhookEventType(event)
  if (!canonicalEvent) throw new Error(`Unsupported webhook event: ${event}`)
  if (isV1EventPayload(payload)) {
    return {
      ...payload,
      object: "event",
      type: normalizeWebhookEventType(String(payload.type)) ?? canonicalEvent,
      schema: V1_WEBHOOK_VERSION,
    }
  }

  const createdAt = typeof payload.created === "string" ? payload.created : undefined
  const merchantId = typeof payload.merchantId === "string" ? payload.merchantId : null
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : {}

  return buildWebhookEnvelope(
    event,
    {
      id: data.paymentId ?? payload.id ?? null,
      object: canonicalEvent.startsWith("checkout.session.") ? "checkout.session"
        : canonicalEvent.startsWith("payment_link.") ? "payment_link"
        : "payment",
      merchantId,
      paymentId: data.paymentId ?? null,
      checkoutLinkId: data.checkoutLinkId ?? null,
      amount: data.amount ?? null,
      currency: data.currency ?? null,
      status: data.status ?? null,
      reference: data.reference ?? null,
      metadata: data.metadata ?? {},
    },
    { createdAt, livemode: false }
  )
}

async function sendStoredWebhookPayload(input: {
  config: MerchantWebhook
  event: WebhookEvent
  payload: Record<string, unknown>
}) {
  const payload = normalizeStoredPayload(input.event, input.payload)
  const payloadJson = JSON.stringify(payload)
  const timestamp = new Date().toISOString()
  const signature = await signPayload(payloadJson, input.config.secret, timestamp)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-PineTree-Event": String(payload.type),
    "X-PineTree-Signature": `sha256=${signature}`,
    "X-PineTree-Timestamp": timestamp,
    "PineTree-Signature": `sha256=${signature}`,
    "PineTree-Timestamp": timestamp,
    "PineTree-Event-Id": getPayloadEventId(payload),
    [WEBHOOK_SCHEMA_HEADER]: V1_WEBHOOK_VERSION,
    [LEGACY_SCHEMA_HEADER]: V1_WEBHOOK_VERSION,
  }

  let responseStatus: number | null = null
  let responseBody: string | null = null
  let lastError: string | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  try {
    const destination = await assertSafeWebhookUrl(input.config.url)
    const controller = new AbortController()
    timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    const response = await fetch(destination, {
      method: "POST",
      headers,
      body: payloadJson,
      signal: controller.signal,
      redirect: "manual",
    })
    responseStatus = response.status
    responseBody = (await response.text()).slice(0, 1000)
    if (response.status >= 300 && response.status < 400) {
      lastError = "Webhook redirects are not followed"
    } else if (!response.ok) {
      lastError = `HTTP ${response.status}`
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Delivery failed"
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  return {
    status: lastError === null ? "delivered" as const : "failed" as const,
    responseStatus,
    responseBody,
    lastError,
    headers,
  }
}

export async function deliverWebhook(
  merchantId: string,
  event: WebhookEvent,
  data: WebhookPaymentData
): Promise<void> {
  let webhookConfig = null
  try {
    webhookConfig = await getMerchantWebhook(merchantId)
  } catch (err) {
    console.error("[webhook] failed to load config:", err)
    return
  }

  if (!webhookConfig || !webhookConfig.enabled) return
  const canonicalEvent = normalizeWebhookEventType(event)
  if (!canonicalEvent || !webhookSubscriptionMatches(webhookConfig.events, canonicalEvent)) return

  try {
    const payload = buildPaymentWebhookEvent(canonicalEvent, data)
    const attempt = await sendStoredWebhookPayload({
      config: webhookConfig,
      event: canonicalEvent,
      payload,
    })
    await insertWebhookDelivery({
      merchantId,
      webhookId: webhookConfig.id,
      event: canonicalEvent,
      payload,
      status: attempt.status,
      responseStatus: attempt.responseStatus,
      responseBody: attempt.responseBody,
      attemptCount: 1,
      lastError: attempt.lastError,
    })
  } catch (err) {
    console.error("[webhook] delivery error:", err)
  }
}

export function buildV1CheckoutSessionEvent(
  event: Extract<WebhookEvent, `checkout.session.${string}`>,
  session: PublicCheckoutSession,
  createdAt = new Date().toISOString()
) {
  return buildWebhookEnvelope(event, session as unknown as Record<string, unknown>, { createdAt })
}

export async function deliverV1CheckoutSessionWebhook(
  merchantId: string,
  event: Extract<WebhookEvent, `checkout.session.${string}`>,
  session: PublicCheckoutSession
): Promise<void> {
  let webhookConfig = null
  try {
    webhookConfig = await getMerchantWebhook(merchantId)
  } catch (err) {
    console.error("[webhook] failed to load config:", err)
    return
  }
  const canonicalEvent = normalizeWebhookEventType(event)
  if (
    !webhookConfig ||
    !webhookConfig.enabled ||
    !canonicalEvent ||
    !canonicalEvent.startsWith("checkout.session.") ||
    !webhookSubscriptionMatches(webhookConfig.events, canonicalEvent)
  ) return

  const payload = buildV1CheckoutSessionEvent(
    canonicalEvent as Extract<WebhookEvent, `checkout.session.${string}`>,
    session
  )
  try {
    const attempt = await sendStoredWebhookPayload({
      config: webhookConfig,
      event: canonicalEvent,
      payload,
    })
    await insertWebhookDelivery({
      merchantId,
      webhookId: webhookConfig.id,
      event: canonicalEvent,
      payload,
      status: attempt.status,
      responseStatus: attempt.responseStatus,
      responseBody: attempt.responseBody,
      attemptCount: 1,
      lastError: attempt.lastError,
    })
  } catch (err) {
    console.error("[webhook] v1 checkout delivery error:", err)
  }
}

export async function retryWebhookDelivery(
  merchantId: string,
  deliveryId: string
): Promise<WebhookDelivery | null> {
  const delivery = await getWebhookDeliveryById(deliveryId, merchantId)
  if (!delivery) return null
  const config = await getMerchantWebhookById(delivery.webhook_id, merchantId)
  if (!config) return null
  const canonicalEvent = normalizeWebhookEventType(delivery.event)
  if (!canonicalEvent) return null

  const attempt = await sendStoredWebhookPayload({
    config,
    event: canonicalEvent,
    payload: delivery.payload,
  })
  return updateWebhookDeliveryAttempt({
    id: delivery.id,
    merchantId,
    status: attempt.status,
    responseStatus: attempt.responseStatus,
    responseBody: attempt.responseBody,
    lastError: attempt.lastError,
    attemptCount: Number(delivery.attempt_count || 0) + 1,
  })
}

export async function retryEligibleWebhookDeliveries(limit = 25) {
  const deliveries = await listRetryEligibleWebhookDeliveries(limit)
  const results = await Promise.allSettled(
    deliveries.map((delivery) =>
      retryWebhookDelivery(delivery.merchant_id, delivery.id)
    )
  )
  return {
    attempted: deliveries.length,
    completed: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  }
}

export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ── Test webhook delivery ──────────────────────────────────────────────────────

export type WebhookTestResult = {
  success: boolean
  statusCode: number | null
  responseBody: string | null
  deliveryId: string | null
  sentAt: string
  event: WebhookEvent
  error?: string
}

/**
 * Send a signed test event to the merchant's configured webhook URL.
 *
 * Reuses the same payload structure, HMAC signing, and logging as live
 * deliveries. Test events use `livemode: false`. Results are logged to
 * webhook_deliveries so they appear in the delivery log.
 *
 * Returns an error (not throws) when the webhook is unconfigured, disabled,
 * or not subscribed to the requested event.
 */
export async function testWebhookDelivery(
  merchantId: string,
  event: WebhookEvent,
): Promise<WebhookTestResult> {
  const sentAt = new Date().toISOString()

  let config: MerchantWebhook | null = null
  try {
    config = await getMerchantWebhook(merchantId)
  } catch {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: "Failed to load webhook configuration" }
  }

  if (!config) {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: "No webhook endpoint configured" }
  }
  if (!config.enabled) {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: "Webhook is disabled — enable it first" }
  }
  const canonicalEvent = normalizeWebhookEventType(event)
  if (!canonicalEvent) {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: `Unsupported webhook event: ${event}` }
  }
  if (!webhookSubscriptionMatches(config.events, canonicalEvent)) {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: `Webhook is not subscribed to ${event}` }
  }

  const testData: WebhookPaymentData = {
    paymentId: `test_${generateEventId().slice(4)}`,
    merchantId,
    amount: 4999,
    currency: "USD",
    status: canonicalEvent === "payment.confirmed" ? "CONFIRMED"
      : canonicalEvent === "payment.failed" ? "FAILED"
      : canonicalEvent === "payment.created" ? "CREATED"
      : canonicalEvent === "payment.pending" ? "PENDING"
      : canonicalEvent === "payment.processing" ? "PROCESSING"
      : canonicalEvent === "payment.expired" ? "EXPIRED"
      : canonicalEvent === "payment.canceled" ? "CANCELLED"
      : canonicalEvent === "payment.refunded" ? "REFUNDED"
      : "INCOMPLETE",
    reference: "test_event",
    metadata: { test: true, triggeredFrom: "dashboard" },
  }

  const payload = buildTestWebhookEvent(canonicalEvent, merchantId, testData)
  const attempt = await sendStoredWebhookPayload({ config, event: canonicalEvent, payload })
  const delivery = await insertWebhookDelivery({
    merchantId,
    webhookId: config.id,
    event: canonicalEvent,
    payload,
    status: attempt.status,
    responseStatus: attempt.responseStatus,
    responseBody: attempt.responseBody,
    attemptCount: 1,
    lastError: attempt.lastError,
  })

  return {
    success: attempt.status === "delivered",
    statusCode: attempt.responseStatus,
    responseBody: attempt.responseBody,
    deliveryId: delivery?.id ?? null,
    sentAt,
    event: canonicalEvent,
    ...(attempt.lastError ? { error: attempt.lastError } : {}),
  }
}
