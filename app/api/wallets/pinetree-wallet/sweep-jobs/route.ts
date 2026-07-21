import { type NextRequest, NextResponse } from "next/server"
import { listSweepJobsForMerchant } from "@/database/walletSweepJobs"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || "25")
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.round(limitParam), 1), 100) : 25
    const jobs = await listSweepJobsForMerchant(merchantId, limit)
    return NextResponse.json({ jobs })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sweep jobs"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
