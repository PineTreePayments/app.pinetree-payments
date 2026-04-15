/**
 * PineTree Payment Status Update
 * 
 * Handles payment status transitions with proper state machine validation.
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
import { emitEvent } from "./eventBus"

/**
 * Update payment status with state machine validation
 * 
 * @param paymentId - The payment ID to update
 * @param nextStatus - The new status to transition to
 * @param metadata - Optional metadata for the event
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

  if (nextStatus === "CONFIRMED") {
    const split = (payment.metadata as { split?: Record<string, unknown> } | null)?.split
    const feeCaptureMethod = String(split?.feeCaptureMethod || "").trim().toLowerCase()
    const hasSplitMetadata = Boolean(
      String(split?.merchantWallet || "").trim() &&
      String(split?.pinetreeWallet || "").trim()
    )

    // Fee capture is considered validated when:
    //   invoice_split / collection_then_settle → the webhook itself IS the confirmation
    //   atomic_split (Solana)                  → watcher verified both on-chain outputs
    //   contract_split (EVM)                   → watcher verified tx to split contract
    //
    // In the watcher path (atomic_split / contract_split) the rawPayload always contains
    // feeCaptureValidated=true once the on-chain checks pass.
    // In the webhook path (invoice_split / collection_then_settle) we trust the provider.
    const feeCaptureValidated =
      feeCaptureMethod === "invoice_split" ||
      feeCaptureMethod === "collection_then_settle" ||
      Boolean(
        (metadata?.rawPayload as { feeCaptureValidated?: boolean } | undefined)?.feeCaptureValidated
      )

    if (!hasSplitMetadata || !feeCaptureMethod || !feeCaptureValidated) {
      throw new Error(
        `Fee capture validation failed for method "${feeCaptureMethod}": payment cannot be confirmed`
      )
    }
  }

  // Validate the transition is allowed
  assertValidTransition(currentStatus, nextStatus)

  // Update the payment status in database
  const updatedPayment = await updatePaymentStatusInDb(paymentId, nextStatus)

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

  // Emit event to event bus for real-time updates
  const pineTreeEvent = eventType
  await emitEvent(pineTreeEvent, {
    paymentId: paymentId,
    status: nextStatus,
    previousStatus: currentStatus
  })

  return updatedPayment
}

/**
 * Convert payment status to event type
 */
function statusToEventType(status: PaymentStatus): PaymentEventType {
  const mapping: Record<PaymentStatus, PaymentEventType> = {
    CREATED: "payment.created",
    PENDING: "payment.pending",
    PROCESSING: "payment.processing",
    CONFIRMED: "payment.confirmed",
    FAILED: "payment.failed",
    INCOMPLETE: "payment.cancelled"
  }

  return mapping[status]
}

/**
 * Mark a payment as confirmed
 */
export async function confirmPayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "CONFIRMED", metadata)
}

/**
 * Mark a payment as failed
 */
export async function failPayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "FAILED", metadata)
}

/**
 * Mark a payment as processing
 */
export async function startProcessingPayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "PROCESSING", metadata)
}

/**
 * Mark a payment as expired
 */
export async function expirePayment(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "INCOMPLETE", metadata)
}

/**
 * Mark a payment as incomplete/abandoned
 */
export async function markPaymentIncomplete(
  paymentId: string,
  metadata?: { providerEvent?: string; rawPayload?: unknown }
) {
  return updatePaymentStatus(paymentId, "INCOMPLETE", metadata)
}