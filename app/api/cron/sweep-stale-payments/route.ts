import { NextRequest, NextResponse } from "next/server"
import { sweepStalePayments } from "@/engine/paymentStateActions"

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
 * Marks CREATED/PENDING payments older than 5 minutes as INCOMPLETE when
 * there is no transaction evidence (provider_reference, metadata txhash/
 * signature, or transactions table entry).
 *
 * Each swept payment receives:
 *   - a DB status update to INCOMPLETE
 *   - a payment_events row (event_type: "payment.cancelled")
 *   - a payment.incomplete webhook delivery (fire-and-forget)
 *   - the linked payment_intent expired for state consistency
 *
 * Called by Supabase Cron via pg_cron + pg_net every 5 minutes.
 * Requires Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await sweepStalePayments(100)

    return NextResponse.json({
      scanned: result.checked,
      markedIncomplete: result.swept,
      skipped: result.skipped,
      errors: result.errors,
      skippedReasons: result.skippedReasons,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:sweep-stale-payments] fatal error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
