/**
 * GET /api/mesh/connections
 * Lists the authenticated merchant's Mesh exchange connections.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { listMeshConnections } from "@/database/meshConnections"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return errorResponse("Unauthorized", getRouteErrorStatus(err))
  }

  try {
    const connections = await listMeshConnections(merchantId)
    return NextResponse.json({ success: true, connections })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list exchange connections"
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
}
