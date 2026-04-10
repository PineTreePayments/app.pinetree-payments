/**
 * PineTree Payment Status Update
 * 
 * Handles payment status transitions with proper state machine validation.
 */

import { assertValidTransition, PaymentStatus } from "./paymentStateMachine"
import {
  updatePaymentStatus as updatePaymentStatusInDb,
  getPaymentById,
  createPaymentEvent,
  PaymentEventType
} from "@/lib/database"
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

  const currentStatus = payment.status

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
    INCOMPLETE: "payment.cancelled",
    EXPIRED: "payment.expired",
    REFUNDED: "payment.refunded"
  }

  return mapping[status] || "payment.pending"
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