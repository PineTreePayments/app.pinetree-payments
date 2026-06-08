import { NextRequest, NextResponse } from "next/server"
import { sweepStalePayments } from "@/engine/stalePaymentSweep"

// Same CRON_SECRET guard used by /api/cron/check-payments and /api/cron/update-balances.
// Set CRON_SECRET in your environment (Vercel env vars or equivalent).
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron:sweep-stale-payments] CRON_SECRET is not set - rejecting request")
    return false
  }
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

/**
 * POST /api/cron/sweep-stale-payments
 *
 * Runs a bounded engine sweep. Every candidate is reloaded and checked for
 * provider references, hashes/signatures, invoices, and processing events
 * before the canonical status helper may mark it INCOMPLETE.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const summary = await sweepStalePayments({ maxRows: 250, staleAfterMs: 5 * 60 * 1000 })
    console.info("[cron:sweep-stale-payments]", summary)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stale payment sweep failed"
    console.error("[cron:sweep-stale-payments] failed:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
