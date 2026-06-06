import { NextRequest, NextResponse } from "next/server"
import { getPaymentsByStatus, supabaseAdmin, supabase as supabaseAnon } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"

const db = supabaseAdmin ?? supabaseAnon

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron:check-payments] Missing CRON_SECRET — rejecting request")
    return false
  }
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // ── Phase 1: Stale payment sweep ──────────────────────────────────────────
    // Delegates to public.sweep_stale_payments() — a bounded Postgres function
    // that handles candidate selection, bulk status update, event insertion, and
    // intent expiry in a single transaction with an advisory lock.
    const { data: sweepResult, error: sweepError } = await db
      .rpc("sweep_stale_payments", { max_rows: 250, stale_after: "5 minutes" })

    if (sweepError) {
      console.error("[cron:check-payments] sweep RPC failed:", sweepError.message)
    }

    // ── Phase 2: Blockchain checks for recently active payments ───────────────
    // After the sweep, remaining CREATED/PENDING/PROCESSING are recent enough
    // to still need on-chain verification.
    const [created, pending, processing] = await Promise.all([
      getPaymentsByStatus("CREATED", 50),
      getPaymentsByStatus("PENDING", 50),
      getPaymentsByStatus("PROCESSING", 50)
    ])

    const watchable = [...created, ...pending, ...processing]

    if (watchable.length === 0) {
      return NextResponse.json({ checked: 0, sweepResult: sweepResult ?? null })
    }

    // Run watcher iterations in parallel — each does a single blockchain check.
    // Each check is raced against an 8s timeout so the function always returns
    // within Vercel's free-tier 10s limit regardless of RPC latency.
    const runWatcher = (payment: typeof watchable[number]) =>
      Promise.race([
        runPaymentWatcher(payment.id),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("watcher_timeout")), 8000)
        )
      ])

    const results = await Promise.allSettled(watchable.map(runWatcher))

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    return NextResponse.json({
      checked: watchable.length,
      succeeded,
      failed,
      sweepResult: sweepResult ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:check-payments] fatal error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
