import { NextRequest, NextResponse } from "next/server"
import { reconcileBasePaymentFromChain } from "@/engine/baseChainReconciliation"

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  if (!secret) {
    console.error("[internal:base-payments-reconcile] Missing CRON_SECRET or INTERNAL_API_SECRET")
    return false
  }
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

// Manual/administrative repair for a single Base payment — re-verifies it
// directly against the chain (same code the automatic self-heal pass in
// engine/paymentMaintenance.ts and every routine watcher check use) and, if
// genuine on-chain evidence is found, advances it through the standard
// engine pipeline. Safe to call repeatedly; a payment with no evidence, or
// already CONFIRMED, is a no-op.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ paymentId: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { paymentId: rawPaymentId } = await context.params
  const paymentId = String(rawPaymentId || "").trim()
  if (!paymentId) {
    return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({})) as { timeoutMs?: number }
    const timeoutMs = Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : undefined
    const result = await reconcileBasePaymentFromChain(paymentId, { timeoutMs })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Base payment reconciliation failed"
    console.error("[internal:base-payments-reconcile] failed", { paymentId, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
