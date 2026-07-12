import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminLightningSweepById } from "@/engine/adminLightningSweeps"

type RouteContext = { params: Promise<{ sweepId: string }> }

function message(error: unknown) {
  return error instanceof Error ? error.message : "Lightning sweep lookup failed"
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { sweepId } = await context.params
    await requireAdminFromRequest(req)
    const sweep = await getAdminLightningSweepById(sweepId)
    return NextResponse.json({ sweep }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}
