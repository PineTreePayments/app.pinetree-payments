import { NextRequest, NextResponse } from "next/server"
import { getPaymentsByStatus } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"

// Vercel cron secret — set CRON_SECRET in your Vercel env vars to secure this endpoint
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
    // Check CREATED, PENDING, and PROCESSING payments — all are watchable states
    const [created, pending, processing] = await Promise.all([
      getPaymentsByStatus("CREATED", 50),
      getPaymentsByStatus("PENDING", 50),
      getPaymentsByStatus("PROCESSING", 50)
    ])

    const watchable = [...created, ...pending, ...processing]

    if (watchable.length === 0) {
      return NextResponse.json({ checked: 0 })
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
      failed
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:check-payments] fatal error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
