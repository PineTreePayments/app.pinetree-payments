/**
 * Internal-only. Lists Lightning sweep state for admin visibility -
 * merchant, source payment, queued amount, Speed account reference, status,
 * attempts, next retry, provider send id, sanitized last error, timestamps.
 * Never exposed to merchants.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminLightningSweeps } from "@/engine/adminLightningSweeps"

function message(error: unknown) {
  return error instanceof Error ? error.message : "Lightning sweep lookup failed"
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const merchantId = req.nextUrl.searchParams.get("merchantId") || undefined
    const limitParam = req.nextUrl.searchParams.get("limit")
    const limit = limitParam ? Number(limitParam) : undefined

    const sweeps = await getAdminLightningSweeps({ merchantId, limit })
    return NextResponse.json({ sweeps }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}
