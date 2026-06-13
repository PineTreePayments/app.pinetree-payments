import {
  getMerchantWebhook,
  getMerchantWebhookById,
  getWebhookDeliveryById,
  insertWebhookDelivery,
  listRetryEligibleWebhookDeliveries,
  updateWebhookDeliveryAttempt,
  type WebhookEvent,
  type WebhookDelivery,
  type MerchantWebhook,
} from "@/database/merchantWebhooks"
import type { PublicCheckoutSession } from "./publicCheckoutSessions"

const WEBHOOK_TIMEOUT_MS = 10_000
export const V1_WEBHOOK_VERSION = "2026-06-12"

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

function generateEventId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `evt_${hex}`
}

function buildEventPayload(
  event: WebhookEvent,
  data: WebhookPaymentData
): { payload: Record<string, unknown>; timestamp: string } {
  const timestamp = new Date().toISOString()
  return {
    timestamp,
    payload: {
      id: generateEventId(),
      type: event,
      created: timestamp,
      merchantId: data.merchantId,
      data: {
        paymentId: data.paymentId,
        checkoutLinkId: data.checkoutLinkId ?? null,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        reference: data.reference ?? null,
        metadata: data.metadata ?? null,
      },
    },
  }
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function isV1EventPayload(payload: Record<string, unknown>) {
  const data = payload.data
  return Boolean(
    payload.eventId &&
    payload.type &&
    payload.createdAt &&
    data &&
    typeof data === "object" &&
    (data as Record<string, unknown>).object
  )
}

function getPayloadEventId(payload: Record<string, unknown>) {
  const value = payload.eventId || payload.id
  return typeof value === "string" ? value : generateEventId()
}

async function sendStoredWebhookPayload(input: {
  config: MerchantWebhook
  event: WebhookEvent
  payload: Record<string, unknown>
}) {
  const payloadJson = JSON.stringify(input.payload)
  const timestamp = new Date().toISOString()
  const signature = await signPayload(payloadJson, input.config.secret)
  const v1 = isV1EventPayload(input.payload)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-PineTree-Event": input.event,
    "X-PineTree-Signature": `sha256=${signature}`,
    "X-PineTree-Timestamp": timestamp,
  }
  if (v1) {
    headers["PineTree-Signature"] = `sha256=${signature}`
    headers["PineTree-Timestamp"] = timestamp
    headers["PineTree-Event-Id"] = getPayloadEventId(input.payload)
    headers["PineTree-Webhook-Version"] = V1_WEBHOOK_VERSION
  }

  let responseStatus: number | null = null
  let responseBody: string | null = null
  let lastError: string | null = null
  try {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    const response = await fetch(input.config.url, {
      method: "POST",
      headers,
      body: payloadJson,
      signal: controller.signal,
    })
    clearTimeout(timeoutHandle)
    responseStatus = response.status
    responseBody = (await response.text()).slice(0, 1000)
    if (!response.ok) lastError = `HTTP ${response.status}`
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Delivery failed"
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
  if (!webhookConfig.events.includes(event)) return

  const { payload, timestamp } = buildEventPayload(event, data)
  const payloadJson = JSON.stringify(payload)

  let signature = ""
  try {
    signature = await signPayload(payloadJson, webhookConfig.secret)
  } catch (err) {
    console.error("[webhook] failed to sign payload:", err)
    return
  }

  let responseStatus: number | null = null
  let responseBody: string | null = null
  let deliveryStatus: "delivered" | "failed" = "failed"

  try {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    const res = await fetch(webhookConfig.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PineTree-Event": event,
        "X-PineTree-Signature": `sha256=${signature}`,
        "X-PineTree-Timestamp": timestamp,
      },
      body: payloadJson,
      signal: controller.signal,
    })

    clearTimeout(timeoutHandle)
    responseStatus = res.status
    responseBody = (await res.text()).slice(0, 1000)
    deliveryStatus = res.ok ? "delivered" : "failed"
  } catch (err) {
    console.error("[webhook] delivery error:", err)
  }

  await insertWebhookDelivery({
    merchantId,
    webhookId: webhookConfig.id,
    event,
    payload,
    status: deliveryStatus,
    responseStatus,
    responseBody,
    attemptCount: 1,
    lastError: deliveryStatus === "failed"
      ? responseStatus
        ? `HTTP ${responseStatus}`
        : "Delivery failed"
      : null,
  })
}

export function buildV1CheckoutSessionEvent(
  event: Extract<WebhookEvent, `checkout.session.${string}`>,
  session: PublicCheckoutSession,
  createdAt = new Date().toISOString()
) {
  return {
    eventId: generateEventId(),
    type: event,
    createdAt,
    data: {
      object: session,
    },
  }
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
  if (!webhookConfig || !webhookConfig.enabled || !webhookConfig.events.includes(event)) return

  const payload = buildV1CheckoutSessionEvent(event, session)
  try {
    const attempt = await sendStoredWebhookPayload({
      config: webhookConfig,
      event,
      payload,
    })
    await insertWebhookDelivery({
      merchantId,
      webhookId: webhookConfig.id,
      event,
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

  const attempt = await sendStoredWebhookPayload({
    config,
    event: delivery.event,
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
 * deliveries. The payload includes `"_test": true` so recipients can
 * distinguish test events. Results are logged to webhook_deliveries so they
 * appear in the delivery log.
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
  if (!config.events.includes(event)) {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: `Webhook is not subscribed to ${event}` }
  }

  const testData: WebhookPaymentData = {
    paymentId: `test_${generateEventId().slice(4)}`,
    merchantId,
    amount: 4999,
    currency: "USD",
    status: event === "payment.confirmed" ? "CONFIRMED"
      : event === "payment.failed" ? "FAILED"
      : "INCOMPLETE",
    reference: "test_event",
    metadata: { test: true, triggeredFrom: "dashboard" },
  }

  const { payload, timestamp } = buildEventPayload(event, testData)
  const payloadWithTestFlag = { ...payload, _test: true }
  const payloadJson = JSON.stringify(payloadWithTestFlag)

  let signature = ""
  try {
    signature = await signPayload(payloadJson, config.secret)
  } catch {
    return { success: false, statusCode: null, responseBody: null, deliveryId: null, sentAt, event, error: "Failed to sign payload" }
  }

  let statusCode: number | null = null
  let responseBody: string | null = null
  let deliveryStatus: "delivered" | "failed" = "failed"
  let errorMsg: string | undefined

  try {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PineTree-Event": event,
        "X-PineTree-Signature": `sha256=${signature}`,
        "X-PineTree-Timestamp": timestamp,
        "X-PineTree-Test": "1",
      },
      body: payloadJson,
      signal: controller.signal,
    })

    clearTimeout(timeoutHandle)
    statusCode = res.status
    responseBody = (await res.text()).slice(0, 1000)
    deliveryStatus = res.ok ? "delivered" : "failed"
    if (!res.ok) errorMsg = `Non-2xx response: ${res.status}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delivery failed"
    errorMsg = msg.includes("abort") || msg.includes("AbortError")
      ? `Timed out after ${WEBHOOK_TIMEOUT_MS / 1000}s`
      : msg
  }

  const deliveryId = crypto.randomUUID()

  await insertWebhookDelivery({
    merchantId,
    webhookId: config.id,
    event,
    payload: payloadWithTestFlag,
    status: deliveryStatus,
    responseStatus: statusCode,
    responseBody,
    attemptCount: 1,
    lastError: errorMsg ?? null,
  })

  return {
    success: deliveryStatus === "delivered",
    statusCode,
    responseBody,
    deliveryId,
    sentAt,
    event,
    ...(errorMsg ? { error: errorMsg } : {}),
  }
}
