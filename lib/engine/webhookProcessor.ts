/**
 * PineTree Webhook Processor
 * 
 * Handles incoming webhooks from payment providers.
 * Verifies signatures, translates events, and updates payment status.
 */

import { getProvider } from "./providerRegistry"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { emitEvent } from "./eventBus"
import { getPaymentById, createPaymentEvent } from "@/lib/database"
import { PaymentStatus } from "./paymentStateMachine"

type WebhookInput = {
  provider: string
  payload: any
  headers?: any
}

type TranslatedEvent = {
  paymentId: string
  event:
    | "payment.created"
    | "payment.pending"
    | "payment.processing"
    | "payment.confirmed"
    | "payment.failed"
    | "payment.cancelled"
    | "payment.incomplete"
    | "payment.expired"
    | "payment.refunded"
}

const eventToStatus: Record<TranslatedEvent["event"], PaymentStatus> = {
  "payment.created": "CREATED",
  "payment.pending": "PENDING",
  "payment.processing": "PROCESSING",
  "payment.confirmed": "CONFIRMED",
  "payment.failed": "FAILED",
  "payment.cancelled": "INCOMPLETE",
  "payment.incomplete": "INCOMPLETE",
  "payment.expired": "EXPIRED",
  "payment.refunded": "REFUNDED"
}

/**
 * Process a webhook from a payment provider
 * 
 * @param input - Webhook input containing provider, payload, and headers
 */
export async function processWebhook({
  provider,
  payload,
  headers
}: WebhookInput) {
  const adapter = getProvider(provider)

  if (!adapter) {
    throw new Error(`Unknown provider: ${provider}`)
  }

  /* ---------------------------
     SIGNATURE EXTRACTION
  --------------------------- */

  const signature =
    headers?.["x-cc-webhook-signature"] ||
    headers?.["x-signature"] ||
    headers?.["x-shift4-signature"] ||
    ""

  /* ---------------------------
     SAFE WEBHOOK VERIFICATION
  --------------------------- */

  let verified = true

  if (adapter.verifyWebhook) {
    verified = adapter.verifyWebhook(payload, signature)
  }

  if (!verified) {
    throw new Error("Webhook verification failed")
  }

  /* ---------------------------
     TRANSLATE EVENT
  --------------------------- */

  let event: TranslatedEvent | null = null

  if (adapter.translateEvent) {
    event = adapter.translateEvent(payload) as TranslatedEvent | null
  }

  if (!event || !event.paymentId) {
    console.warn("Could not translate webhook event:", payload)
    return
  }

  /* ---------------------------
     VERIFY PAYMENT EXISTS
  --------------------------- */

  const payment = await getPaymentById(event.paymentId)

  if (!payment) {
    console.warn("Payment not found for webhook:", event.paymentId)
    return
  }

  /* ---------------------------
     CREATE EVENT RECORD
  --------------------------- */

  const eventId = crypto.randomUUID()
  
  await createPaymentEvent({
    id: eventId,
    payment_id: event.paymentId,
    event_type: event.event,
    provider_event: payload?.event?.type,
    raw_payload: payload
  })

  /* ---------------------------
     UPDATE PAYMENT STATUS
  --------------------------- */

  const status = eventToStatus[event.event]

  try {
    await updatePaymentStatus(
      event.paymentId,
      status,
      {
        providerEvent: payload?.event?.type,
        rawPayload: payload
      }
    )
  } catch (error: any) {
    // Ignore invalid transition errors (e.g., already confirmed)
    if (error.message.includes("Invalid payment transition")) {
      console.warn("Ignoring invalid transition:", error.message)
    } else {
      throw error
    }
  }

  /* ---------------------------
     EMIT EVENT
  --------------------------- */

  await emitEvent(event.event, {
    paymentId: event.paymentId,
    status,
    provider
  })
}

/**
 * Process multiple webhooks in batch
 */
export async function processWebhooks(webhooks: WebhookInput[]) {
  const results = await Promise.allSettled(
    webhooks.map(webhook => processWebhook(webhook))
  )

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  )

  if (failures.length > 0) {
    console.error(`${failures.length} webhooks failed to process`)
  }

  return {
    total: webhooks.length,
    succeeded: results.filter(r => r.status === "fulfilled").length,
    failed: failures.length
  }
}