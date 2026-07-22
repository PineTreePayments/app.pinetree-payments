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
    const body = (await req.json().catch(() => ({}))) as { limit?: number; merchantId?: string }
    const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 50
    const merchantId = typeof body.merchantId === "string" && body.merchantId.trim() ? body.merchantId.trim() : undefined
    // Historical/one-off repair: pass merchantId to force-reconcile a single
    // merchant's currently-stuck processing withdrawals on demand (e.g. a
    // support report of a withdrawal stuck at "Processing") instead of
    // waiting for the next scheduled sweep. Still requires real provider
    // evidence via reconcileProcessingWithdrawals - never blindly confirms.
    const result = await reconcileProcessingWithdrawals({ limit, merchantId })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Withdrawal reconciliation failed"
    console.error("[internal:reconcile-withdrawals] failed", { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
