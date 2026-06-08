import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminOverview } from "@/engine/adminOverview"
import { schedulePaymentMaintenance } from "@/lib/api/paymentMaintenance"

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    schedulePaymentMaintenance("admin.overview")
    const result = await getAdminOverview()
    return NextResponse.json(result)
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/overview] error", { status, message, err })
    return NextResponse.json({ error: message }, { status })
  }
}
