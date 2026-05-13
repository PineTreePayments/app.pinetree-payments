import {
  getMerchantWebhook,
  insertWebhookDelivery,
  type WebhookEvent,
} from "@/database/merchantWebhooks"

const WEBHOOK_TIMEOUT_MS = 10_000

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
  })
}

export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
