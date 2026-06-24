import { NextRequest, NextResponse } from "next/server"
import { processPendingLightningPayoutJobs } from "@/engine/lightningPayouts"

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  if (!secret) {
    console.error("[internal:lightning-payouts] Missing CRON_SECRET or INTERNAL_API_SECRET")
    return false
  }
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({})) as { limit?: number }
    const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 25
    const summary = await processPendingLightningPayoutJobs({ limit })
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lightning payout processing failed"
    console.error("[internal:lightning-payouts] failed", { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
