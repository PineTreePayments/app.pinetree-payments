import { type NextRequest, NextResponse } from "next/server"
import { processQueuedLightningSettlementPayoutJobs } from "@/engine/lightningSettlement"

function isAuthorized(req: NextRequest) {
  const secret = String(process.env.INTERNAL_API_SECRET || "").trim()
  if (!secret) {
    console.error("[internal:lightning-settlement-payouts] Missing INTERNAL_API_SECRET")
    return false
  }
  return req.headers.get("authorization") === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    // Security: amount and destination address are intentionally ignored. The
    // processor only reads queued jobs and their saved, merchant-owned active
    // payout destinations from the database.
    const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 5
    const summary = await processQueuedLightningSettlementPayoutJobs({ limit })
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lightning settlement payout processing failed"
    console.error("[internal:lightning-settlement-payouts] failed", { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
