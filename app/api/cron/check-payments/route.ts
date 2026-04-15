import { NextRequest, NextResponse } from "next/server"
import { getPaymentsByStatus } from "@/database"
import { queueSingleWatcherIteration } from "@/engine/paymentStatusOrchestrator"

// Vercel cron secret — set CRON_SECRET in your Vercel env vars to secure this endpoint
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // open if no secret configured (dev)
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

    // Run watcher iterations in parallel — each does a single blockchain check
    const results = await Promise.allSettled(
      watchable.map((payment) =>
        queueSingleWatcherIteration(payment, "cron:check-payments")
      )
    )

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
