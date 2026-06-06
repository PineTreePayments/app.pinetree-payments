import { getPaymentById, getStalePaymentsForSweep } from "@/database"
import { getTransactionByPaymentId } from "@/database/transactions"
import { getPaymentIntentByPaymentId, expirePaymentIntent } from "@/database/paymentIntents"
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

// ── Network-wide stale payment sweep ──────────────────────────────────────────

export type StaleSweepResult = {
  checked: number
  swept: number
  skipped: number
  errors: number
  /** Counts of why individual payments were skipped, for operational diagnostics. */
  skippedReasons: Record<string, number>
}

/**
 * Network-wide stale payment sweep.
 *
 * Fetches CREATED and PENDING payments older than 5 minutes, oldest first,
 * and marks each INCOMPLETE when there is no transaction evidence on-chain,
 * in the transactions table, or in payment metadata.
 *
 * Also expires the linked payment_intent (if any) for state consistency.
 *
 * Writes a payment_event and fires the payment.incomplete webhook for every
 * payment swept (via updatePaymentStatus → createPaymentEvent + deliverWebhook).
 *
 * Safe to call repeatedly — all per-payment guards in markPaymentIncomplete
 * still apply (provider_reference, metadata broadcast evidence, transaction
 * table lookup, and the 5-minute abandonment window).
 *
 * Designed for the check-payments cron; also callable from admin routes.
 */
export async function sweepStalePayments(limit = 100): Promise<StaleSweepResult> {
  let payments: Awaited<ReturnType<typeof getStalePaymentsForSweep>>

  try {
    payments = await getStalePaymentsForSweep(ABANDONED_PAYMENT_TIMEOUT_MS, limit)
  } catch (err) {
    console.error("[stale-sweep] failed to fetch stale payments", err)
    return { checked: 0, swept: 0, skipped: 0, errors: 1, skippedReasons: {} }
  }

  if (payments.length === 0) {
    return { checked: 0, swept: 0, skipped: 0, errors: 0, skippedReasons: {} }
  }

  let swept = 0
  let skipped = 0
  let errors = 0
  const skippedReasons: Record<string, number> = {}

  for (const payment of payments) {
    try {
      const marked = await markPaymentIncomplete(payment.id, {
        providerEvent: "cron.stale_payment_sweep",
        rawPayload: {
          sweepReason: "no_activity_timeout",
          timeoutMinutes: 5,
          previousStatus: payment.status,
        },
        requireAbandonedTimeout: true,
      })

      if (marked) {
        swept++
        // Best-effort intent expiry — must not block sweep progress on error
        void expireLinkedPaymentIntent(payment.id)
      } else {
        // Categorise skip reason using data already in memory (no extra DB query)
        const hasProviderRef = Boolean(String(payment.provider_reference || "").trim())
        const hasMetadataEvidence = metadataHasBroadcastEvidence(payment.metadata)
        const reason = hasProviderRef
          ? "has_provider_reference"
          : hasMetadataEvidence
          ? "has_metadata_evidence"
          : "transaction_table_has_evidence_or_state_transition_invalid"
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1
        skipped++
      }
    } catch (err) {
      console.error("[stale-sweep] error sweeping payment", {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      })
      errors++
    }
  }

  console.info("[stale-sweep] sweep complete", { checked: payments.length, swept, skipped, errors, skippedReasons })
  return { checked: payments.length, swept, skipped, errors, skippedReasons }
}

async function expireLinkedPaymentIntent(paymentId: string): Promise<void> {
  try {
    const intent = await getPaymentIntentByPaymentId(paymentId)
    if (intent) {
      await expirePaymentIntent(intent.id)
    }
  } catch (err) {
    console.error("[stale-sweep] failed to expire linked intent", {
      paymentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
