import { NextRequest, NextResponse } from "next/server"
import { getPaymentsByStatus } from "@/database"
import { runPaymentWatcher } from "@/engine/checkPaymentOnce"
import { sweepStalePayments } from "@/engine/stalePaymentSweep"

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron:check-payments] Missing CRON_SECRET - rejecting request")
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
    const sweepResult = await sweepStalePayments({
      maxRows: 250,
      staleAfterMs: 5 * 60 * 1000
    }).catch((error) => {
      console.error(
        "[cron:check-payments] sweep failed:",
        error instanceof Error ? error.message : String(error)
      )
      return null
    })

    const [created, pending, processing] = await Promise.all([
      getPaymentsByStatus("CREATED", 50),
      getPaymentsByStatus("PENDING", 50),
      getPaymentsByStatus("PROCESSING", 50)
    ])

    const watchable = [...created, ...pending, ...processing]

    if (watchable.length === 0) {
      return NextResponse.json({ checked: 0, sweepResult })
    }

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
      sweepResult
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:check-payments] fatal error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
