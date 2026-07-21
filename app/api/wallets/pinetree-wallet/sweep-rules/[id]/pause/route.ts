import { type NextRequest, NextResponse } from "next/server"
import { pauseMerchantSweepRule } from "@/engine/withdrawals/walletSweepRules"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

/**
 * Immediately disables a sweep rule. Always available with no confirmation
 * friction, unlike enabling one - "pause automatic sweeps" must never be
 * harder than starting them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await params
    const rule = await pauseMerchantSweepRule(merchantId, id)
    return NextResponse.json({ rule })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to pause sweep rule"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
