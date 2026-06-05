import { getPaymentById } from "@/database"
import { getTransactionByPaymentId } from "@/database/transactions"
import { updatePaymentStatus } from "./updatePaymentStatus"

const ABANDONED_PAYMENT_TIMEOUT_MS = 5 * 60 * 1000

function metadataHasBroadcastEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false

  const stack: unknown[] = [value]
  const evidenceKeys = new Set([
    "txhash",
    "transactionhash",
    "transactionid",
    "signature",
    "providersignature",
    "providertransactionid"
  ])

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== "object") continue

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[_-]+/g, "").toLowerCase()
      if (evidenceKeys.has(normalizedKey) && String(raw || "").trim()) {
        return true
      }
      if (raw && typeof raw === "object") stack.push(raw)
    }
  }

  return false
}

function isOlderThanAbandonedTimeout(createdAt: string | null | undefined): boolean {
  const createdAtMs = new Date(String(createdAt || "")).getTime()
  return Number.isFinite(createdAtMs) && Date.now() - createdAtMs >= ABANDONED_PAYMENT_TIMEOUT_MS
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
  }
): Promise<boolean> {
  try {
    const payment = await getPaymentById(paymentId)
    if (!payment) return false

    const status = String(payment.status || "").toUpperCase()
    if (["CONFIRMED", "FAILED", "INCOMPLETE"].includes(status)) return false
    if (status !== "CREATED" && status !== "PENDING") return false

    if (metadata?.requireAbandonedTimeout && !isOlderThanAbandonedTimeout(payment.created_at)) return false

    const transaction = await getTransactionByPaymentId(paymentId)
    const hasProviderReference = Boolean(String(payment.provider_reference || "").trim())
    const hasTransactionReference = Boolean(String(transaction?.provider_transaction_id || "").trim())
    if (hasTransactionReference || metadataHasBroadcastEvidence(payment.metadata)) return false
    if (metadata?.requireAbandonedTimeout && hasProviderReference) return false

    await updatePaymentStatus(paymentId, "INCOMPLETE", metadata)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("Invalid payment transition")) throw error
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
