/**
 * PineTree Engine — On-Demand Payment Check
 *
 * Performs a single, non-blocking blockchain/provider check for a given payment
 * and updates the database status if a confirmation is found.
 *
 * Use this function instead of the continuous watchPayment loop whenever you
 * need an on-demand check:
 *   - Webhook handlers that need to verify before acknowledging
 *   - Manual "refresh status" API calls
 *   - Any future retry logic triggered by an event (not a timer)
 *
 * DO NOT call this in a loop or from a setInterval. It is designed for
 * one-shot invocation only. The Vercel cron at /api/cron/check-payments
 * is the only scheduled caller and it wraps each call in an 8-second
 * timeout to stay within serverless execution limits.
 */

import { getPaymentById } from "@/database"
import {
  queueSingleWatcherIteration,
  normalizePaymentStatus
} from "./paymentStatusOrchestrator"

export type CheckPaymentOnceResult = {
  paymentId: string
  /** Normalised status after the check (may be unchanged if no on-chain match was found) */
  status: string
  found: boolean
}

/**
 * Check a payment once against the blockchain / provider and update the DB.
 *
 * @param paymentId  The PineTree payment UUID to check.
 * @returns          The latest normalised status and whether the payment exists.
 */
export async function checkPaymentOnce(paymentId: string): Promise<CheckPaymentOnceResult> {
  const trimmedId = String(paymentId || "").trim()
  if (!trimmedId) {
    throw new Error("checkPaymentOnce: paymentId is required")
  }

  const payment = await getPaymentById(trimmedId)
  if (!payment) {
    return { paymentId: trimmedId, status: "NOT_FOUND", found: false }
  }

  // queueSingleWatcherIteration handles all status guards (terminal states, missing
  // metadata, etc.) and updates the DB if a match is found on chain.
  await queueSingleWatcherIteration(payment, "checkPaymentOnce")

  // Re-fetch to surface any status change written during the check above.
  const updated = await getPaymentById(trimmedId)
  const status = normalizePaymentStatus(updated?.status ?? payment.status)

  return { paymentId: trimmedId, status, found: true }
}
