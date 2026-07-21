import { type NextRequest, NextResponse } from "next/server"
import { listPendingClientSweepJobs } from "@/database/walletSweepJobs"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

/**
 * Used by the wallet page's automatic-sweep continuation hook: queued (or
 * previously AWAITING_GAS, now potentially fundable) Base/Solana jobs this
 * authenticated session's embedded wallet can complete. Bitcoin jobs never
 * appear here - they execute unattended server-side via the cron processor.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const jobs = await listPendingClientSweepJobs(merchantId)
    return NextResponse.json({ jobs })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load pending sweep jobs"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
