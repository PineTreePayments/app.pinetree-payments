/**
 * POST /api/admin/backfill/reconcile-transactions
 *
 * One-time admin utility to reconcile diverged transaction statuses with their
 * canonical payment status, and to sweep stale CREATED/PENDING payments that
 * were never cleaned up by the cron sweep.
 *
 * Defaults to DRY-RUN mode — no writes are made unless body.dry_run is
 * explicitly false AND the confirm token is provided.
 *
 * Dry-run request (safe to run at any time):
 *   POST /api/admin/backfill/reconcile-transactions
 *   { "dry_run": true }          ← or omit dry_run entirely (defaults to true)
 *
 * Execute request (irreversible — requires confirm token):
 *   POST /api/admin/backfill/reconcile-transactions
 *   { "dry_run": false, "confirm": "RECONCILE_BACKFILL" }
 *
 * Optional parameters:
 *   max_rows     number  Max payments per phase (default 500, hard cap 500).
 *   stale_after_ms  number  Minimum payment age for Phase 2 (default 5 min).
 *                           Cannot be set below the 5-minute checkout timeout.
 *
 * Response shape (BackfillSummary):
 *   {
 *     scanned:            number,
 *     skipped:            number,
 *     updatedPayments:    number,
 *     updatedTransactions: number,
 *     examples:           BackfillResultEntry[],
 *     skipReasons:        Record<string, number>,
 *     dryRun:             boolean
 *   }
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { runTransactionBackfill } from "@/engine/transactionBackfill"

const CONFIRM_TOKEN = "RECONCILE_BACKFILL"
const MAX_ROWS = 500

export async function POST(req: NextRequest) {
  try {
    const adminId = await requireAdminFromRequest(req)

    const body = (await req.json()) as {
      dry_run?: unknown
      confirm?: unknown
      max_rows?: unknown
      stale_after_ms?: unknown
    }

    // Default to dry-run unless the caller explicitly opts in to execute mode.
    const dryRun = body.dry_run !== false

    if (!dryRun && body.confirm !== CONFIRM_TOKEN) {
      return NextResponse.json(
        {
          error: `Execute mode requires confirm: "${CONFIRM_TOKEN}". Omit dry_run or set it to true for a safe preview.`,
        },
        { status: 400 }
      )
    }

    const maxRows = Math.min(
      typeof body.max_rows === "number" && body.max_rows > 0
        ? body.max_rows
        : MAX_ROWS,
      MAX_ROWS
    )

    const staleAfterMs =
      typeof body.stale_after_ms === "number" && body.stale_after_ms > 0
        ? body.stale_after_ms
        : undefined

    console.log("[admin/backfill/reconcile-transactions] starting", {
      adminId,
      dryRun,
      maxRows,
      staleAfterMs,
    })

    const summary = await runTransactionBackfill({ dryRun, maxRows, staleAfterMs })

    console.log("[admin/backfill/reconcile-transactions] complete", {
      adminId,
      dryRun: summary.dryRun,
      scanned: summary.scanned,
      skipped: summary.skipped,
      updatedPayments: summary.updatedPayments,
      updatedTransactions: summary.updatedTransactions,
    })

    return NextResponse.json(summary)
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message =
      err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/backfill/reconcile-transactions] error", {
      status,
      message,
    })
    return NextResponse.json({ error: message }, { status })
  }
}
