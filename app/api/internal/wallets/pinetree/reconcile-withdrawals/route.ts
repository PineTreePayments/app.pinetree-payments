import { NextRequest, NextResponse } from "next/server"
import { reconcileProcessingWithdrawals } from "@/engine/withdrawals/walletWithdrawalReconciliation"

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  if (!secret) {
    console.error("[internal:reconcile-withdrawals] Missing CRON_SECRET or INTERNAL_API_SECRET")
    return false
  }
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: number }
    const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 50
    const result = await reconcileProcessingWithdrawals({ limit })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Withdrawal reconciliation failed"
    console.error("[internal:reconcile-withdrawals] failed", { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
