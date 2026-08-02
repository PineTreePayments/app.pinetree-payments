/**
 * PineTree Engine - bounded Shift4 reconciliation.
 *
 * Discovers due, unresolved Shift4 attempts by querying
 * `shift4_payment_attempts` directly. The previous implementation loaded the
 * oldest non-terminal PAYMENTS across every rail and filtered for Shift4 in
 * memory, so on a busy platform the bounded page was almost always full of
 * Base, Solana, Speed, Stripe, and FluidPay rows and Shift4 work could starve
 * indefinitely. Nothing here touches another rail.
 *
 * Safe to call repeatedly: each attempt is claimed under a database lease, and
 * every write carries the version it read, so two concurrent runs cannot both
 * act on one attempt and a slow run cannot overwrite a fresher result.
 *
 * This phase adds NO cron schedule. The function is exported so the existing
 * maintenance tick can call it later behind a bounded, isolated branch.
 */

import {
  claimDueShift4PaymentAttempts,
  listDueShift4PaymentAttempts,
} from "@/database/shift4PaymentAttempts"

import { recoverClaimedAttempt, type Shift4RecoveryOutcome } from "./recoverUnknownOutcome"

/** How long one reconciliation run holds a claimed attempt. */
const RECONCILIATION_LEASE_SECONDS = 120

export type Shift4ReconciliationScope = {
  merchantId?: string
  merchantProviderConnectionId?: string
  paymentId?: string
  attemptId?: string
  /** Maximum attempts claimed in one run. Bounded to 200. */
  limit?: number
  /** Report what would happen without contacting Shift4 or writing. */
  dryRun?: boolean
  /** Identifies this worker's lease. Defaults to a per-run identity. */
  leaseOwner?: string
  now?: number
}

export type Shift4ReconciliationSummary = {
  runId: string
  dryRun: boolean
  /** Attempts the query found due (dry run) or the lease granted (live run). */
  attemptsDue: number
  attemptsClaimed: number
  resolvedApproved: number
  resolvedDeclined: number
  invoiceNotFound: number
  stillUnresolved: number
  exhausted: number
  skipped: number
  failures: number
  resendEligible: number
  /**
   * Continuation cursor: the (next_check_at, created_at, id) of the last
   * attempt this run handled, matching the deterministic claim ordering. A
   * follow-up run resumes after it rather than re-walking from the start.
   */
  cursor: { nextCheckAt: string | null; createdAt: string; id: string } | null
  durationMs: number
}

/**
 * Reconcile unresolved Shift4 attempts.
 *
 * Bounded by `limit` (default 25, hard cap 200) so one run cannot make an
 * unbounded number of provider calls.
 */
export async function reconcileShift4Payments(
  scope: Shift4ReconciliationScope = {}
): Promise<Shift4ReconciliationSummary> {
  const runId = crypto.randomUUID()
  const startedAt = Date.now()
  const now = scope.now ?? startedAt
  const nowIso = new Date(now).toISOString()
  const limit = Math.max(1, Math.min(scope.limit ?? 25, 200))
  const dryRun = scope.dryRun === true
  const leaseOwner = scope.leaseOwner || `shift4-reconcile-${runId}`

  const summary: Shift4ReconciliationSummary = {
    runId,
    dryRun,
    attemptsDue: 0,
    attemptsClaimed: 0,
    resolvedApproved: 0,
    resolvedDeclined: 0,
    invoiceNotFound: 0,
    stillUnresolved: 0,
    exhausted: 0,
    skipped: 0,
    failures: 0,
    resendEligible: 0,
    cursor: null,
    durationMs: 0,
  }

  /* ── Dry run: read only, never claim, never write ──────────────────────── */
  if (dryRun) {
    const due = await listDueShift4PaymentAttempts({
      now: nowIso,
      limit,
      merchantId: scope.merchantId ?? null,
      merchantProviderConnectionId: scope.merchantProviderConnectionId ?? null,
      paymentId: scope.paymentId ?? null,
      attemptId: scope.attemptId ?? null,
    })

    summary.attemptsDue = due.length
    summary.stillUnresolved = due.length

    const last = due[due.length - 1]
    if (last) {
      summary.cursor = {
        nextCheckAt: last.next_check_at,
        createdAt: last.created_at,
        id: last.id,
      }
    }

    summary.durationMs = Date.now() - startedAt
    return summary
  }

  /* ── Live run: claim a bounded batch under a lease ─────────────────────── */
  const claimed = await claimDueShift4PaymentAttempts({
    leaseOwner,
    leaseSeconds: RECONCILIATION_LEASE_SECONDS,
    limit,
    merchantId: scope.merchantId ?? null,
    merchantProviderConnectionId: scope.merchantProviderConnectionId ?? null,
    paymentId: scope.paymentId ?? null,
    attemptId: scope.attemptId ?? null,
    now: nowIso,
  })

  summary.attemptsDue = claimed.length
  summary.attemptsClaimed = claimed.length

  for (const row of claimed) {
    try {
      const outcome = await recoverClaimedAttempt({
        attempt: {
          attempt_id: row.attemptId,
          merchant_id: row.merchantId,
          payment_id: row.paymentId,
          merchant_provider_connection_id: row.merchantProviderConnectionId,
          operation: row.operation,
          invoice: row.invoice,
          amount_minor: row.amountMinor,
          correlation_id: row.correlationId,
          lookup_attempt_count: row.lookupAttemptCount,
          resend_count: row.resendCount,
          version: row.version,
          state: row.state,
          recovery_state: row.recoveryState,
          response_code: row.responseCode,
          authorization_code: row.authorizationCode,
          retrieval_reference: row.retrievalReference,
          resolution_reason: row.resolutionReason,
        },
        leaseOwner,
        now,
      })
      tally(summary, outcome)
    } catch (recoveryError) {
      summary.failures += 1
      console.warn("[shift4-engine] reconciliation_attempt_failed", {
        runId,
        paymentId: row.paymentId,
        attemptId: row.attemptId,
        reason: recoveryError instanceof Error ? recoveryError.message : "unknown",
      })
    }
  }

  const last = claimed[claimed.length - 1]
  if (last) {
    summary.cursor = {
      nextCheckAt: last.nextCheckAt,
      createdAt: last.leaseExpiresAt ?? nowIso,
      id: last.attemptRowId,
    }
  }

  summary.durationMs = Date.now() - startedAt

  console.info("[shift4-engine] reconciliation_complete", {
    runId,
    dryRun,
    attemptsClaimed: summary.attemptsClaimed,
    resolvedApproved: summary.resolvedApproved,
    resolvedDeclined: summary.resolvedDeclined,
    stillUnresolved: summary.stillUnresolved,
    failures: summary.failures,
    durationMs: summary.durationMs,
  })

  return summary
}

function tally(summary: Shift4ReconciliationSummary, outcome: Shift4RecoveryOutcome): void {
  if (outcome.resendEligible) summary.resendEligible += 1

  switch (outcome.action) {
    case "resolved_approved":
      summary.resolvedApproved += 1
      return
    case "resolved_declined":
      summary.resolvedDeclined += 1
      return
    case "invoice_not_found":
      summary.invoiceNotFound += 1
      return
    case "exhausted":
      summary.exhausted += 1
      return
    case "skipped":
      summary.skipped += 1
      return
    case "not_due":
    case "still_unresolved":
    default:
      summary.stillUnresolved += 1
  }
}
