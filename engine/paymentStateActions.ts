import { getPaymentById } from "@/database"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { paymentHasProcessingEvidence } from "./paymentEvidence"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { CHECKOUT_TIMEOUT_MS } from "./config"

function isOlderThanTimeout(
  value: string | null | undefined,
  timeoutMs: number
): boolean {
  const timestamp = new Date(String(value || "")).getTime()
  return Number.isFinite(timestamp) && Date.now() - timestamp >= timeoutMs
}

export type PaymentIncompleteEligibility = {
  eligible: boolean
  status: string
  reason: string
}

export async function getPaymentIncompleteEligibility(
  paymentId: string,
  options?: { minimumAgeMs?: number }
): Promise<PaymentIncompleteEligibility> {
  const payment = await getPaymentById(paymentId)
  if (!payment) {
    return { eligible: false, status: "NOT_FOUND", reason: "payment_not_found" }
  }

  const status = String(payment.status || "").toUpperCase()
  if (["CONFIRMED", "FAILED", "INCOMPLETE"].includes(status)) {
    return { eligible: false, status, reason: "terminal_status_not_eligible" }
  }
  if (status === "PROCESSING") {
    return { eligible: false, status, reason: "processing_requires_reconciliation" }
  }
  if (status !== "CREATED" && status !== "PENDING") {
    return { eligible: false, status, reason: "status_not_eligible" }
  }

  const minimumAgeMs = options?.minimumAgeMs ?? 0
  const activityAt = payment.updated_at || payment.created_at
  if (minimumAgeMs > 0 && !isOlderThanTimeout(activityAt, minimumAgeMs)) {
    return { eligible: false, status, reason: "recent_payment_not_eligible" }
  }

  const [transaction, events] = await Promise.all([
    getTransactionByPaymentId(paymentId),
    getPaymentEvents(paymentId).catch(() => [])
  ])
  if (paymentHasProcessingEvidence({ payment, transaction, events })) {
    return { eligible: false, status, reason: "payment_has_processing_evidence" }
  }

  return {
    eligible: true,
    status,
    reason: status === "CREATED"
      ? "created_no_activity_timeout"
      : "pending_no_activity_timeout"
  }
}

/**
 * Mark a payment as incomplete/abandoned.
 *
 * Skips terminal states and any payment with provider or transaction evidence.
 * Callers can require the standard five-minute checkout abandonment window.
 */
export async function markPaymentIncomplete(
  paymentId: string,
  metadata?: {
    providerEvent?: string
    rawPayload?: unknown
    requireAbandonedTimeout?: boolean
    minimumAgeMs?: number
  }
): Promise<boolean> {
  try {
    const minimumAgeMs = metadata?.minimumAgeMs ??
      (metadata?.requireAbandonedTimeout ? CHECKOUT_TIMEOUT_MS : 0)
    const eligibility = await getPaymentIncompleteEligibility(paymentId, { minimumAgeMs })
    if (!eligibility.eligible) return false

    if (eligibility.status === "CREATED") {
      await updatePaymentStatus(paymentId, "PENDING", {
        providerEvent: metadata?.providerEvent,
        rawPayload: {
          ...(metadata?.rawPayload && typeof metadata.rawPayload === "object"
            ? metadata.rawPayload as Record<string, unknown>
            : {}),
          stateMachineStep: "created_to_pending_before_incomplete"
        }
      })
    }
    await updatePaymentStatus(paymentId, "INCOMPLETE", metadata)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      !message.includes("Invalid payment transition") &&
      !message.includes("Concurrent payment transition skipped")
    ) {
      throw error
    }
    return false
  }
}

export async function markPaymentIncompleteIfAbandoned(paymentId: string): Promise<boolean> {
  return markPaymentIncomplete(paymentId, {
    providerEvent: "checkout_abandoned_timeout",
    rawPayload: { timeoutMinutes: 5 },
    requireAbandonedTimeout: true
  })
}
