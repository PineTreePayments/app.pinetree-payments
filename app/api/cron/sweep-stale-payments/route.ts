import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database"

const db = supabaseAdmin ?? supabaseAnon

type SweepSummary = {
  locked: boolean
  scanned: number
  markedIncomplete: number
  expiredIntents: number
  skipped: number
  cutoff: string | null
}

// Same CRON_SECRET guard used by /api/cron/check-payments and /api/cron/update-balances.
// Set CRON_SECRET in your environment (Vercel env vars or equivalent).
// For Supabase Cron, store the value in Supabase Vault and reference it from the pg_cron job.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron:sweep-stale-payments] CRON_SECRET is not set — rejecting request")
    return false
  }
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

/**
 * POST /api/cron/sweep-stale-payments
 *
 * Delegates to public.sweep_stale_payments() — a bounded Postgres function
 * that selects stale CREATED/PENDING payments, bulk-updates them to INCOMPLETE,
 * writes payment_events, and expires linked payment_intents in a single
 * transaction.
 *
 * The database function holds pg_try_advisory_xact_lock so overlapping calls
 * are safe — the second caller returns immediately with locked:true.
 *
 * Called by Supabase Cron via pg_cron + pg_net every 5 minutes.
 * Requires Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await db
    .rpc("sweep_stale_payments", { max_rows: 250, stale_after: "5 minutes" })

  if (error) {
    console.error("[cron:sweep-stale-payments] RPC failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = data as SweepSummary
  console.info("[cron:sweep-stale-payments]", summary)

  return NextResponse.json(summary)
}
