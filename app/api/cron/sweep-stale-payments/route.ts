import { NextRequest, NextResponse } from "next/server"
import { sweepStalePayments } from "@/engine/stalePaymentSweep"

export const maxDuration = 60

// Supabase Cron reads the bearer value from Supabase Vault. This route validates
// the matching CRON_SECRET stored in the Vercel production environment.
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
 * Sole production stale-payment scheduler target. Supabase pg_cron invokes
 * this POST route every minute through net.http_post.
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
