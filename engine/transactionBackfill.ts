/**
 * One-time backfill engine for reconciling diverged transaction statuses.
 *
 * Phase 1 — Terminal payment → transaction sync
 *   For payments already in CONFIRMED / FAILED / INCOMPLETE, bring the linked
 *   transaction row into alignment using reconcileTransactionForPayment so all
 *   existing guard rules (Rule 10, Rule 11, evidence guard) are respected.
 *
 * Phase 2 — Stale CREATED / PENDING → INCOMPLETE
 *   For payments older than the checkout timeout with no provider evidence,
 *   mark them INCOMPLETE through the existing state-action flow so
 *   payment_events and linked-transaction reconciliation remain consistent.
 *
 * Safety guarantees (mirrors the engine rules):
 *   - CONFIRMED is never downgraded on either payment or transaction.
 *   - FAILED never becomes INCOMPLETE (Rule 11).
 *   - FAILED always propagates to the transaction even when
 *     provider_transaction_id is set (the fix from reconcileTransaction.ts).
 *   - INCOMPLETE only syncs to the transaction when transaction.provider_transaction_id
 *     is not set (mirrors Rule 3c in reconcileTransactionForPayment exactly).
 *   - PROCESSING payments are never touched — they are excluded from both
 *     DB queries by design.
 *
 * Reused helpers:
 *   reconcileTransactionForPayment  (engine/reconcileTransaction.ts)
 *   getPaymentIncompleteEligibility / markPaymentIncomplete  (engine/paymentStateActions.ts)
 *   CHECKOUT_TIMEOUT_MS / NON_TERMINAL_TX_STATUSES          (engine/config.ts, engine/reconcileTransaction.ts)
 */

import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"
import { getTransactionByPaymentId } from "@/database/transactions"
import {
  reconcileTransactionForPayment,
  NON_TERMINAL_TX_STATUSES,
  type TerminalPaymentStatus,
} from "./reconcileTransaction"
import {
  getPaymentIncompleteEligibility,
  markPaymentIncomplete,
} from "./paymentStateActions"
import { CHECKOUT_TIMEOUT_MS } from "./config"

const db = supabaseAdmin || supabaseAnon

const MAX_EXAMPLES = 20

export type BackfillResultEntry = {
  paymentId: string
  paymentStatus: string
  previousTxStatus: string | null
  newTxStatus: string | null
  action: "tx_synced" | "payment_marked_incomplete" | "skipped"
  skipReason?: string
}

export type BackfillSummary = {
  scanned: number
  skipped: number
  updatedPayments: number
  updatedTransactions: number
  examples: BackfillResultEntry[]
  skipReasons: Record<string, number>
  dryRun: boolean
}

/**
 * Run the full backfill.  Pass `dryRun: true` to preview without writing.
 *
 * @param options.dryRun      When true: compute and return what would change,
 *                            but make zero DB writes.
 * @param options.maxRows     Upper bound per phase (default 500, max 500).
 * @param options.staleAfterMs  Minimum payment age for Phase 2 (default
 *                            CHECKOUT_TIMEOUT_MS = 5 min).  Cannot be set
 *                            below CHECKOUT_TIMEOUT_MS.
 */
export async function runTransactionBackfill(options: {
  dryRun: boolean
  maxRows?: number
  staleAfterMs?: number
}): Promise<BackfillSummary> {
  const dryRun = options.dryRun
  const maxRows = Math.min(options.maxRows ?? 500, 500)
  const staleAfterMs = Math.max(
    options.staleAfterMs ?? CHECKOUT_TIMEOUT_MS,
    CHECKOUT_TIMEOUT_MS
  )
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString()

  let scanned = 0
  let skipped = 0
  let updatedPayments = 0
  let updatedTransactions = 0
  const examples: BackfillResultEntry[] = []
  const skipReasonCounts: Record<string, number> = {}

  function addSkip(entry: BackfillResultEntry) {
    skipped++
    const r = entry.skipReason ?? "unknown"
    skipReasonCounts[r] = (skipReasonCounts[r] ?? 0) + 1
    if (examples.length < MAX_EXAMPLES) examples.push(entry)
  }

  function addUpdate(
    entry: BackfillResultEntry,
    kind: "payment" | "transaction"
  ) {
    if (kind === "payment") updatedPayments++
    else updatedTransactions++
    if (examples.length < MAX_EXAMPLES) examples.push(entry)
  }

  // ── Phase 1: terminal payment → linked transaction sync ───────────────────
  // PROCESSING is intentionally excluded; it is handled by the payment watcher.

  type PaymentRow = {
    id: string
    status: string
  }

  const { data: terminalRows, error: terminalErr } = await db
    .from("payments")
    .select("id, status")
    .in("status", ["CONFIRMED", "FAILED", "INCOMPLETE"])
    .order("updated_at", { ascending: false })
    .limit(maxRows)

  if (terminalErr) {
    throw new Error(`Backfill phase-1 query failed: ${terminalErr.message}`)
  }

  for (const row of (terminalRows ?? []) as PaymentRow[]) {
    scanned++
    const paymentId = row.id
    const paymentStatus = row.status

    const transaction = await getTransactionByPaymentId(paymentId)

    if (!transaction) {
      addSkip({
        paymentId,
        paymentStatus,
        previousTxStatus: null,
        newTxStatus: null,
        action: "skipped",
        skipReason: "no_linked_transaction",
      })
      continue
    }

    const prevTxStatus = transaction.status

    if (paymentStatus === "CONFIRMED") {
      // CONFIRMED always wins — only skip if the transaction is already CONFIRMED.
      if (prevTxStatus === "CONFIRMED") {
        addSkip({
          paymentId,
          paymentStatus,
          previousTxStatus: prevTxStatus,
          newTxStatus: null,
          action: "skipped",
          skipReason: "already_in_sync",
        })
        continue
      }
    } else {
      // FAILED or INCOMPLETE

      // Rule 10: never downgrade a confirmed transaction.
      if (prevTxStatus === "CONFIRMED") {
        addSkip({
          paymentId,
          paymentStatus,
          previousTxStatus: prevTxStatus,
          newTxStatus: null,
          action: "skipped",
          skipReason: "transaction_already_confirmed",
        })
        continue
      }

      const targetTxStatus =
        paymentStatus === "FAILED" ? "FAILED" : "INCOMPLETE"

      // Already in sync — no work needed.
      if (prevTxStatus === targetTxStatus) {
        addSkip({
          paymentId,
          paymentStatus,
          previousTxStatus: prevTxStatus,
          newTxStatus: null,
          action: "skipped",
          skipReason: "already_in_sync",
        })
        continue
      }

      // Can only write to non-terminal transactions (Rule 3b of reconciliation).
      if (!NON_TERMINAL_TX_STATUSES.has(prevTxStatus)) {
        addSkip({
          paymentId,
          paymentStatus,
          previousTxStatus: prevTxStatus,
          newTxStatus: null,
          action: "skipped",
          skipReason: "transaction_already_terminal",
        })
        continue
      }

      // Evidence guard for INCOMPLETE — mirrors Rule 3c in reconcileTransactionForPayment.
      // Only transaction.provider_transaction_id is checked so dry-run and execute
      // predict the same skip set.  FAILED bypasses this guard — it is always authoritative.
      if (paymentStatus === "INCOMPLETE") {
        const hasProviderTxId = Boolean(String(transaction.provider_transaction_id || "").trim())
        if (hasProviderTxId) {
          addSkip({
            paymentId,
            paymentStatus,
            previousTxStatus: prevTxStatus,
            newTxStatus: null,
            action: "skipped",
            skipReason: "has_provider_transaction_id",
          })
          continue
        }
      }
    }

    const expectedTxStatus =
      paymentStatus === "CONFIRMED"
        ? "CONFIRMED"
        : paymentStatus === "FAILED"
        ? "FAILED"
        : "INCOMPLETE"

    if (dryRun) {
      addUpdate(
        {
          paymentId,
          paymentStatus,
          previousTxStatus: prevTxStatus,
          newTxStatus: expectedTxStatus,
          action: "tx_synced",
        },
        "transaction"
      )
      continue
    }

    // Execute: delegate to the authoritative reconcile helper.
    const reconcileResult = await reconcileTransactionForPayment(
      paymentId,
      paymentStatus as TerminalPaymentStatus
    )

    if (reconcileResult.skipped) {
      // A race between our pre-check and the DB write: record the skip reason.
      addSkip({
        paymentId,
        paymentStatus,
        previousTxStatus: prevTxStatus,
        newTxStatus: null,
        action: "skipped",
        skipReason: reconcileResult.skipReason ?? "reconcile_skipped",
      })
    } else {
      addUpdate(
        {
          paymentId,
          paymentStatus,
          previousTxStatus: prevTxStatus,
          newTxStatus: reconcileResult.newStatus ?? null,
          action: "tx_synced",
        },
        "transaction"
      )
    }
  }

  // ── Phase 2: stale CREATED / PENDING → INCOMPLETE ─────────────────────────
  // PROCESSING is excluded from this query by the status IN filter.

  const { data: staleRows, error: staleErr } = await db
    .from("payments")
    .select("id, status")
    .in("status", ["CREATED", "PENDING"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(maxRows)

  if (staleErr) {
    throw new Error(`Backfill phase-2 query failed: ${staleErr.message}`)
  }

  for (const row of (staleRows ?? []) as Array<{
    id: string
    status: string
  }>) {
    scanned++
    const paymentId = row.id
    const paymentStatus = row.status

    // getPaymentIncompleteEligibility re-fetches the payment and checks
    // provider evidence + age — this is authoritative.
    const eligibility = await getPaymentIncompleteEligibility(paymentId, {
      minimumAgeMs: staleAfterMs,
    })

    if (!eligibility.eligible) {
      addSkip({
        paymentId,
        paymentStatus,
        previousTxStatus: null,
        newTxStatus: null,
        action: "skipped",
        skipReason: eligibility.reason,
      })
      continue
    }

    if (dryRun) {
      addUpdate(
        {
          paymentId,
          paymentStatus,
          previousTxStatus: null,
          newTxStatus: "INCOMPLETE",
          action: "payment_marked_incomplete",
        },
        "payment"
      )
      continue
    }

    // markPaymentIncomplete creates payment_events internally via updatePaymentStatus.
    const changed = await markPaymentIncomplete(paymentId, {
      providerEvent: "admin.backfill.reconcile-transactions",
      rawPayload: { backfill: true, cutoff, staleAfterMs },
      minimumAgeMs: staleAfterMs,
    })

    if (changed) {
      addUpdate(
        {
          paymentId,
          paymentStatus,
          previousTxStatus: null,
          newTxStatus: "INCOMPLETE",
          action: "payment_marked_incomplete",
        },
        "payment"
      )
    } else {
      addSkip({
        paymentId,
        paymentStatus,
        previousTxStatus: null,
        newTxStatus: null,
        action: "skipped",
        skipReason: "mark_incomplete_rejected",
      })
    }
  }

  return {
    scanned,
    skipped,
    updatedPayments,
    updatedTransactions,
    examples,
    skipReasons: skipReasonCounts,
    dryRun,
  }
}
