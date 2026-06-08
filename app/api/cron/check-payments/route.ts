import { NextRequest, NextResponse } from "next/server"
import { runPaymentMaintenanceTick } from "@/engine/paymentMaintenance"

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
    const summary = await runPaymentMaintenanceTick({
      throttleMs: 1_000,
      sweepLimit: 25,
      watcherLimit: 10,
      reconcileLimit: 25,
      watcherTimeoutMs: 8_000
    })
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[cron:check-payments] fatal error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
