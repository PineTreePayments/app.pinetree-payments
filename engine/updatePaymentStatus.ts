/**
 * PineTree Payment Status Update
 *
 * Handles payment status transitions with proper state machine validation.
 * After each terminal-relevant transition (CONFIRMED, FAILED, INCOMPLETE),
 * fires the corresponding merchant webhook in a fire-and-forget fashion so
 * that webhook delivery failures never block the payment status update.
 */

import {
  assertValidTransition,
  PaymentStatus,
  normalizeToStrictPaymentStatus
} from "./paymentStateMachine"
import {
  updatePaymentStatus as updatePaymentStatusInDb,
  getPaymentById,
  createPaymentEvent,
  PaymentEventType
} from "@/database"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { deliverWebhook, type WebhookPaymentData } from "./webhookDelivery"
import type { WebhookEvent } from "@/database/merchantWebhooks"
import { reconcileTransactionForPayment } from "./reconcileTransaction"
import {
  hasFailureEvidence,
  isExplicitUnpaidInvoiceExpiry,
  paymentHasProcessingEvidence
} from "./paymentEvidence"
import { toPublicCheckoutSessionMetadata } from "./checkoutSessionMetadata"
import { deliverV1CheckoutSessionWebhook } from "./webhookDelivery"

const STATUS_TO_WEBHOOK_EVENT: Partial<Record<PaymentStatus, WebhookEvent>> = {
  CONFIRMED: "payment.confirmed",
  FAILED: "payment.failed",
  INCOMPLETE: "payment.incomplete",
}

/**
 * Update payment status with state machine validation
 */
export async function updatePaymentStatus(
  paymentId: string,
  nextStatus: PaymentStatus,
  metadata?: {
    providerEvent?: string
    rawPayload?: unknown
  }
) {
  // Get current payment to validate transition
  const payment = await getPaymentById(paymentId)

  if (!payment) {
    throw new Error("Payment not found")
  }

  const currentStatus = normalizeToStrictPaymentStatus(payment.status)

  if (nextStatus === "INCOMPLETE") {
    const [transaction, events] = await Promise.all([
      getTransactionByPaymentId(paymentId),
      getPaymentEvents(paymentId).catch(() => [])
    ])
    if (
      paymentHasProcessingEvidence({ payment, transaction, events }) &&
      !isExplicitUnpaidInvoiceExpiry(metadata)
    ) {
      throw new Error("Cannot mark payment INCOMPLETE after provider or transaction evidence exists")
    }
  }

  if (nextStatus === "FAILED" && !hasFailureEvidence(metadata)) {
    throw new Error("Cannot mark payment FAILED without provider or network failure evidence")
  }

  if (nextStatus === "CONFIRMED") {
    const split = (payment.metadata as { split?: Record<string, unknown> } | null)?.split
    const feeCaptureMethod = String(split?.feeCaptureMethod || "").trim().toLowerCase()
    const providerSettledFeeCapture =
      feeCaptureMethod === "invoice_split" ||
      feeCaptureMethod === "collection_then_settle" ||
      // NWC collects PineTree fees post-payment via pay_invoice — no split wallet at confirmation time.
      feeCaptureMethod === "post_payment_nwc"
    const hasRequiredSplitMetadata = providerSettledFeeCapture
      ? Boolean(String(split?.merchantWallet || "").trim())
      : Boolean(
          String(split?.merchantWallet || "").trim() &&
          String(split?.pinetreeWallet || "").trim()
        )

    const feeCaptureValidated =
      providerSettledFeeCapture ||
      feeCaptureMethod === "direct" ||
      Boolean(
        (metadata?.rawPayload as { feeCaptureValidated?: boolean } | undefined)?.feeCaptureValidated
      )

    if (!hasRequiredSplitMetadata || !feeCaptureMethod || !feeCaptureValidated) {
      throw new Error(
        `Fee capture validation failed for method "${feeCaptureMethod}": payment cannot be confirmed`
      )
    }
  }

  // Validate the transition is allowed
  assertValidTransition(currentStatus, nextStatus)

  // Update the payment status in database with a compare-and-set guard. If an
  // overlapping watcher/webhook already moved this payment, this call fails
  // before creating a duplicate lifecycle event.
  const updatedPayment = await updatePaymentStatusInDb(paymentId, nextStatus, currentStatus)

  // Create a payment event for audit trail
  const eventType = statusToEventType(nextStatus)
  const eventId = crypto.randomUUID()

  await createPaymentEvent({
    id: eventId,
    payment_id: paymentId,
    event_type: eventType,
    provider_event: metadata?.providerEvent,
    raw_payload: metadata?.rawPayload
  })

  // ── Transaction reconciliation ─────────────────────────────────────────────
  // Whenever a payment reaches a terminal state, keep the linked transaction row
  // in sync. This is best-effort: a reconciliation failure must never block the
  // authoritative payment status write.
  if (nextStatus === "CONFIRMED" || nextStatus === "FAILED" || nextStatus === "INCOMPLETE") {
    try {
      const reconcileResult = await reconcileTransactionForPayment(paymentId, nextStatus)
      if (!reconcileResult.skipped) {
        console.info("[reconcileTransaction] synced", {
          paymentId,
          paymentStatus: nextStatus,
          previousTxStatus: reconcileResult.previousStatus,
          newTxStatus: reconcileResult.newStatus,
          transactionId: reconcileResult.transactionId,
        })
      }
    } catch (reconcileErr) {
      console.error("[reconcileTransaction] reconcile failed — payment status already committed", {
        paymentId,
        nextStatus,
        error: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr),
      })
    }
  }

  // ── Webhook delivery ───────────────────────────────────────────────────────
  // Fire after the DB write succeeds. Use fire-and-forget so webhook delivery
  // failures never roll back or block the authoritative status update.
  const webhookEvent = STATUS_TO_WEBHOOK_EVENT[nextStatus]
  if (webhookEvent) {
    const meta = (payment.metadata ?? null) as Record<string, unknown> | null
    const webhookData: WebhookPaymentData = {
      paymentId: payment.id,
      merchantId: payment.merchant_id,
      amount: Number(payment.merchant_amount || 0),
      currency: payment.currency,
      status: nextStatus,
      network: payment.network,
      reference: String(meta?.reference || "").trim() || undefined,
      checkoutLinkId: String(meta?.checkoutLinkId || "").trim() || undefined,
      confirmedAt: nextStatus === "CONFIRMED" ? new Date().toISOString() : undefined,
      metadata: meta ? toPublicCheckoutSessionMetadata(meta) : undefined,
    }

    void deliverWebhook(payment.merchant_id, webhookEvent, webhookData).catch((err) => {
      console.error("[webhook] delivery failed after status update:", err)
    })

  }

  const paymentMetadata = (payment.metadata ?? null) as Record<string, unknown> | null
  const checkoutLinkId = String(paymentMetadata?.checkoutLinkId || "").trim()
  const v1Event =
    nextStatus === "PROCESSING"
      ? "checkout.session.processing"
      : nextStatus === "CONFIRMED"
        ? "checkout.session.paid"
        : nextStatus === "FAILED"
          ? "checkout.session.failed"
          : nextStatus === "INCOMPLETE"
            ? "checkout.session.canceled"
            : null
  if (checkoutLinkId && v1Event) {
    void import("./publicCheckoutSessions")
      .then(({ getPublicCheckoutSession }) =>
        getPublicCheckoutSession(payment.merchant_id, checkoutLinkId)
      )
      .then((session) =>
        session
          ? deliverV1CheckoutSessionWebhook(payment.merchant_id, v1Event, session)
          : undefined
      )
      .catch((err) => {
        console.error("[webhook] v1 checkout status delivery failed:", err)
      })
  }

  return updatedPayment
}

function statusToEventType(status: PaymentStatus): PaymentEventType {
  const mapping: Record<PaymentStatus, PaymentEventType> = {
    CREATED: "payment.created",
    PENDING: "payment.pending",
    PROCESSING: "payment.processing",
    CONFIRMED: "payment.confirmed",
    FAILED: "payment.failed",
    INCOMPLETE: "payment.incomplete"
  }

  return mapping[status]
}

export async function confirmPayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "CONFIRMED", metadata)
}

export async function failPayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "FAILED", metadata)
}

export async function startProcessingPayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "PROCESSING", metadata)
}

export async function expirePayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "INCOMPLETE", metadata)
}
