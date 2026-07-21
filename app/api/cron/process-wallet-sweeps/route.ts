import { NextRequest, NextResponse } from "next/server"
import { claimWalletSweepJobs, resetStalledWalletSweepJobs } from "@/database/walletSweepJobs"
import { processClaimedSweepJobs } from "@/engine/withdrawals/walletSweepExecution"
import { evaluateThresholdSweepRules, evaluateDailySweepRules } from "@/engine/withdrawals/walletSweepEvaluation"

export const maxDuration = 60

// Same authorization idiom as the existing production cron routes
// (app/api/cron/sweep-stale-payments/route.ts, app/api/cron/check-payments/route.ts):
// Supabase pg_cron invokes this POST route via net.http_post, reading the
// bearer value from Supabase Vault; this route validates it against
// CRON_SECRET stored in the Vercel production environment. The
// cron.schedule(...) registration itself is not checked into this repo
// (matches the existing two cron routes) - see
// docs/environment/wallet-sweep-env-checklist.md for the exact SQL to run
// manually in the Supabase SQL editor.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron:process-wallet-sweeps] CRON_SECRET is not set - rejecting request")
    return false
  }
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

const CLAIM_BATCH_SIZE = 25
const STALLED_AFTER_SECONDS = 600

/**
 * POST /api/cron/process-wallet-sweeps
 *
 * One tick: reclaim stalled jobs, evaluate threshold/daily rules across all
 * merchants (queues new jobs where eligible), then atomically claim and
 * process a bounded batch of QUEUED jobs. Bitcoin jobs execute immediately;
 * Base/Solana jobs are released back to QUEUED/AWAITING_GAS for client-side
 * completion (see engine/withdrawals/walletSweepExecution.ts's header
 * comment for why). Deliberately bounded (one claim batch per tick, capped
 * rule-evaluation limits) to avoid unbounded loops or excessive provider/RPC
 * polling on a serverless invocation.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const reclaimed = await resetStalledWalletSweepJobs(STALLED_AFTER_SECONDS)
    const [thresholdOutcomes, dailyOutcomes] = await Promise.all([
      evaluateThresholdSweepRules(),
      evaluateDailySweepRules(),
    ])
    const claimedJobs = await claimWalletSweepJobs(CLAIM_BATCH_SIZE)
    const processed = await processClaimedSweepJobs(claimedJobs)

    const summary = {
      reclaimedStalledJobs: reclaimed,
      thresholdQueued: thresholdOutcomes.filter((o) => o.queued).length,
      dailyQueued: dailyOutcomes.filter((o) => o.queued).length,
      claimed: claimedJobs.length,
      ...processed,
    }
    console.info("[cron:process-wallet-sweeps]", summary)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet sweep processing failed"
    console.error("[cron:process-wallet-sweeps] failed:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
