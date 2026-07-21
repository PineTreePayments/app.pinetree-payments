import { type NextRequest, NextResponse } from "next/server"
import { recordClientSweepJobOutcome } from "@/engine/withdrawals/walletSweepExecution"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

/**
 * Called by the client auto-continue hook after it has driven the SAME
 * review -> prepare -> sign -> complete flow every other Base/Solana
 * withdrawal uses (via POST /api/wallets/pinetree-wallet/withdrawals with
 * sweep_job_id, then the existing submit/complete endpoints - no signing or
 * submission logic is duplicated here) to a terminal state. This endpoint
 * only records that outcome against the sweep job/rule for auditability and
 * Activity display.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    const status = String(body.status || "").toUpperCase()
    if (status !== "CONFIRMED" && status !== "FAILED") {
      return NextResponse.json({ error: "status must be CONFIRMED or FAILED." }, { status: 400 })
    }
    const withdrawalId = String(body.withdrawal_id || body.withdrawalId || "").trim()
    if (!withdrawalId) {
      return NextResponse.json({ error: "withdrawal_id is required." }, { status: 400 })
    }

    await recordClientSweepJobOutcome(merchantId, id, {
      status,
      withdrawalId,
      failureReason: body.failure_reason != null ? String(body.failure_reason) : undefined,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record sweep job outcome"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
