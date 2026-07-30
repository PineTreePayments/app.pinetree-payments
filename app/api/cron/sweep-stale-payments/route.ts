import { NextRequest, NextResponse } from "next/server"
import { runPaymentMaintenanceTick } from "@/engine/paymentMaintenance"

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
    // This is the sole production one-minute scheduler target. Run the entire
    // recovery pipeline here so PROCESSING/UNKNOWN rows cannot depend on live
    // checkout traffic or a separate, unscheduled cron endpoint.
    const summary = await runPaymentMaintenanceTick({
      throttleMs: 1_000,
      sweepLimit: 250,
      watcherLimit: 25,
      reconcileLimit: 25,
      watcherTimeoutMs: 8_000,
      lightningReconcileLimit: 25,
      feeSettlementReconcileLimit: 25,
    })
    console.info("[cron:sweep-stale-payments]", summary)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stale payment sweep failed"
    console.error("[cron:sweep-stale-payments] failed:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
