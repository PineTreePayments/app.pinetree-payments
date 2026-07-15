import {
  expirePaymentIntent,
  getPaymentIntentByPaymentId
} from "@/database/paymentIntents"
import { getStalePaymentMaintenanceCandidates } from "@/database/paymentMaintenance"
import { getPaymentIncompleteEligibility, markPaymentIncomplete } from "./paymentStateActions"
import { CHECKOUT_TIMEOUT_MS } from "./config"

// Re-export so existing importers of stalePaymentSweep do not need updating.
export { CHECKOUT_TIMEOUT_MS }

export type StalePaymentSweepSummary = {
  runId: string
  durationMs: number
  scanned: number
  markedIncomplete: number
  expired: number
  incomplete: number
  expiredIntents: number
  skipped: number
  skippedSubmittedEvidence: number
  skippedTerminal: number
  skippedConcurrent: number
  failures: number
  cutoff: string
}

export async function sweepStalePayments(options?: {
  maxRows?: number
  staleAfterMs?: number
  pageSize?: number
}): Promise<StalePaymentSweepSummary> {
  const runId = crypto.randomUUID()
  const startedAt = Date.now()
  const maxRows = Math.max(1, Math.min(options?.maxRows ?? 250, 1_000))
  const pageSize = Math.max(1, Math.min(options?.pageSize ?? 50, 100, maxRows))
  const staleAfterMs = Math.max(options?.staleAfterMs ?? CHECKOUT_TIMEOUT_MS, 60_000)
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString()

  // Load a stable, bounded snapshot before changing any rows. Offset pagination
  // would otherwise shift underneath us as transitioned rows leave the query.
  const candidates: Array<{ id: string; updated_at: string }> = []
  while (candidates.length < maxRows) {
    const remaining = maxRows - candidates.length
    const page = await getStalePaymentMaintenanceCandidates({
      cutoff,
      limit: Math.min(pageSize, remaining),
      offset: candidates.length
    })
    candidates.push(...page)
    if (page.length < Math.min(pageSize, remaining)) break
  }

  let markedIncomplete = 0
  let expiredIntents = 0
  let skippedSubmittedEvidence = 0
  let skippedTerminal = 0
  let skippedConcurrent = 0
  let failures = 0

  for (const row of candidates) {
    try {
      const eligibility = await getPaymentIncompleteEligibility(row.id, {
        minimumAgeMs: staleAfterMs
      })
      if (!eligibility.eligible) {
        if (eligibility.reason === "payment_has_processing_evidence") {
          skippedSubmittedEvidence += 1
        } else if (
          eligibility.reason === "terminal_status_not_eligible" ||
          eligibility.reason === "payment_not_found"
        ) {
          skippedTerminal += 1
        } else {
          skippedConcurrent += 1
        }
        continue
      }

      const changed = await markPaymentIncomplete(row.id, {
        providerEvent: "maintenance.checkout_timeout",
        rawPayload: { cutoff, staleAfterMs },
        minimumAgeMs: staleAfterMs
      })
      if (!changed) {
        skippedConcurrent += 1
        continue
      }

      markedIncomplete += 1
      const intent = await getPaymentIntentByPaymentId(row.id)
      if (intent) {
        await expirePaymentIntent(intent.id)
        expiredIntents += 1
      }
    } catch (error) {
      failures += 1
      console.warn("[payment-maintenance] stale candidate failed", {
        paymentId: row.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    runId,
    durationMs: Date.now() - startedAt,
    scanned: candidates.length,
    markedIncomplete,
    expired: markedIncomplete,
    incomplete: 0,
    expiredIntents,
    skipped: skippedSubmittedEvidence + skippedTerminal + skippedConcurrent,
    skippedSubmittedEvidence,
    skippedTerminal,
    skippedConcurrent,
    failures,
    cutoff
  }
}
