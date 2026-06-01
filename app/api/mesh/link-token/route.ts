/**
 * POST /api/mesh/link-token
 * Creates a Mesh Link token for the authenticated merchant.
 * The link token is returned to the browser so the Mesh Link SDK can open
 * the exchange connection UI. MESH_CLIENT_SECRET never leaves the server.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createMeshLinkToken, isMeshConfigured } from "@/engine/mesh"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return errorResponse("Unauthorized", getRouteErrorStatus(err))
  }

  if (!isMeshConfigured()) {
    return errorResponse(
      "Mesh is not configured on this server. Set MESH_CLIENT_ID and MESH_CLIENT_SECRET.",
      503
    )
  }

  try {
    const linkToken = await createMeshLinkToken(merchantId)
    return NextResponse.json({ success: true, link_token: linkToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create Mesh link token"
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
}
