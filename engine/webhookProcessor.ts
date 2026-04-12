/**
 * PineTree Webhook Processor
 * 
 * Handles incoming webhooks from payment providers.
 * Verifies signatures, translates events, and updates payment status.
 */

import { getProvider } from "./providerRegistry"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { emitEvent } from "./eventBus"
import { getPaymentById, getPaymentByProviderReference, createPaymentEvent } from "@/lib/database"
import { PaymentStatus } from "./paymentStateMachine"
import {
  getTransactionByPaymentId,
  getTransactionByProviderReference,
  updateTransactionProviderReference,
  updateTransactionStatus,
  type TransactionStatus
} from "@/lib/database/transactions"

type WebhookInput = {
  provider: string
  payload: unknown
  headers?: Record<string, string>
}

type TranslatedEvent = {
  paymentId?: string
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

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function getProviderEventType(payload: unknown): string {
  return String(
    readPath(payload, ["event", "type"]) ||
      readPath(payload, ["type"]) ||
      readPath(payload, ["event_type"]) ||
      readPath(payload, ["status"]) ||
      ""
  )
}

function getProviderReferenceCandidates(payload: unknown): string[] {
  const candidates = [
    readPath(payload, ["event", "data", "id"]),
    readPath(payload, ["data", "id"]),
    readPath(payload, ["payment", "id"]),
    readPath(payload, ["id"]),
    readPath(payload, ["charge_id"]),
    readPath(payload, ["reference"]),
    readPath(payload, ["providerReference"]),
    readPath(payload, ["provider_reference"])
  ]

  return [...new Set(candidates.map((value) => String(value || "").trim()).filter(Boolean))]
}

async function resolvePaymentIdFromEvent(input: {
  translatedEvent: TranslatedEvent | null
  payload: unknown
  provider: string
}) {
  const translatedPaymentId = String(input.translatedEvent?.paymentId || "").trim()
  if (translatedPaymentId) {
    return {
      paymentId: translatedPaymentId,
      source: "translated_event"
    }
  }

  const references = getProviderReferenceCandidates(input.payload)
  for (const reference of references) {
    const payment = await getPaymentByProviderReference(reference)
    if (payment) {
      console.info("[webhook] resolved payment by provider reference", {
        provider: input.provider,
        providerReference: reference,
        paymentId: payment.id
      })
      return {
        paymentId: payment.id,
        source: "provider_reference"
      }
    }
  }

  return null
}

async function advancePaymentToTargetStatus(
  paymentId: string,
  targetStatus: PaymentStatus,
  metadata: { providerEvent?: string; rawPayload?: unknown }
) {
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    throw new Error("Payment not found")
  }

  const currentStatus = payment.status as PaymentStatus
  if (currentStatus === targetStatus) {
    return
  }

  // For confirmation-like terminal updates, advance through required lifecycle states.
  if (targetStatus === "CONFIRMED") {
    const transitions: PaymentStatus[] = []

    if (currentStatus === "CREATED") {
      transitions.push("PENDING", "PROCESSING", "CONFIRMED")
    } else if (currentStatus === "PENDING") {
      transitions.push("PROCESSING", "CONFIRMED")
    } else if (currentStatus === "PROCESSING") {
      transitions.push("CONFIRMED")
    }

    if (transitions.length) {
      for (const next of transitions) {
        await updatePaymentStatus(paymentId, next, metadata)
      }
      return
    }
  }

  await updatePaymentStatus(paymentId, targetStatus, metadata)
}

function toTransactionStatus(status: PaymentStatus): TransactionStatus {
  if (status === "CONFIRMED") return "CONFIRMED"
  if (status === "PROCESSING") return "PROCESSING"
  if (status === "FAILED") return "FAILED"
  if (status === "INCOMPLETE" || status === "EXPIRED") return "EXPIRED"
  return "PENDING"
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

  if (!event) {
    console.warn("Could not translate webhook event:", payload)
    return
  }

  const resolution = await resolvePaymentIdFromEvent({
    translatedEvent: event,
    payload,
    provider
  })

  if (!resolution?.paymentId) {
    console.warn("Could not resolve payment id from webhook", {
      provider,
      providerEvent: getProviderEventType(payload)
    })
    return
  }

  const paymentId = resolution.paymentId
  const providerReferences = getProviderReferenceCandidates(payload)

  /* ---------------------------
     VERIFY PAYMENT EXISTS
  --------------------------- */

  const payment = await getPaymentById(paymentId)

  if (!payment) {
    console.warn("Payment not found for webhook:", paymentId)
    return
  }

  const transactionByPayment = await getTransactionByPaymentId(paymentId)
  let transaction = transactionByPayment

  if (!transaction) {
    for (const reference of providerReferences) {
      const byReference = await getTransactionByProviderReference(reference)
      if (byReference) {
        transaction = byReference
        break
      }
    }
  }

  if (transaction && !transaction.provider_transaction_id) {
    const providerReference = providerReferences[0]
    if (providerReference) {
      await updateTransactionProviderReference(transaction.id, providerReference)
      console.info("[webhook] transaction provider reference linked", {
        provider,
        paymentId,
        transactionId: transaction.id,
        providerReference
      })
    }
  }

  /* ---------------------------
     CREATE EVENT RECORD
  --------------------------- */

  const eventId = crypto.randomUUID()
  
  await createPaymentEvent({
    id: eventId,
    payment_id: paymentId,
    event_type: event.event,
    provider_event: getProviderEventType(payload),
    raw_payload: payload
  })

  /* ---------------------------
     UPDATE PAYMENT STATUS
  --------------------------- */

  const status = eventToStatus[event.event]

  try {
    await advancePaymentToTargetStatus(paymentId, status, {
      providerEvent: getProviderEventType(payload),
      rawPayload: payload
    })

    if (transaction) {
      await updateTransactionStatus(transaction.id, toTransactionStatus(status))
    }

    console.info("[webhook] status applied", {
      provider,
      paymentId,
      targetStatus: status,
      event: event.event,
      resolutionSource: resolution.source,
      transactionId: transaction?.id || null
    })
  } catch (error: unknown) {
    // Ignore invalid transition errors (e.g., already confirmed)
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes("Invalid payment transition")) {
      console.warn("Ignoring invalid transition:", {
        paymentId,
        message,
        targetStatus: status,
        provider
      })
    } else {
      throw error
    }
  }

  /* ---------------------------
     EMIT EVENT
  --------------------------- */

  await emitEvent(event.event, {
    paymentId,
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