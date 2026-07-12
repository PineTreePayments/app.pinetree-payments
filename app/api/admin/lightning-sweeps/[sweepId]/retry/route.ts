import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { retryAdminLightningSweep } from "@/engine/adminLightningSweeps"

type RouteContext = { params: Promise<{ sweepId: string }> }

function message(error: unknown) {
  return error instanceof Error ? error.message : "Lightning sweep retry failed"
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { sweepId } = await context.params
    const adminId = await requireAdminFromRequest(req)
    const sweep = await retryAdminLightningSweep({ sweepId, adminId })
    return NextResponse.json({ sweep }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}
