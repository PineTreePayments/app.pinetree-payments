import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminStaleDiagnostic } from "@/database/adminReports"

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    const result = await getAdminStaleDiagnostic()
    return NextResponse.json(result)
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/stale-payments] GET error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
