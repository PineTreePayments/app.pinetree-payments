import { type NextRequest, NextResponse } from "next/server"
import { pauseAllMerchantSweepRules } from "@/engine/withdrawals/walletSweepRules"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

/**
 * Panic-button endpoint: immediately disables every enabled sweep rule for
 * the merchant in one call. No confirmation friction - pausing must always
 * be at least as easy as enabling.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await pauseAllMerchantSweepRules(merchantId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to pause automatic sweeps"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
