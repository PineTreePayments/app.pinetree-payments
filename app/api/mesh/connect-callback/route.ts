/**
 * POST /api/mesh/connect-callback
 * Receives metadata from the Mesh SDK after a merchant connects their exchange.
 * Saves the connection record. No auth token or credentials are stored here —
 * the SDK access token is short-lived and is passed directly during address import.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createMeshConnection } from "@/database/meshConnections"

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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse("Invalid request body", 400)
  }

  try {
    // Resolve institution name from whichever field the SDK provides
    const institutionName =
      (body.institution_name ? String(body.institution_name).trim() : null) ||
      (body.broker_name ? String(body.broker_name).trim() : null) ||
      null

    const connection = await createMeshConnection({
      merchantId,
      provider: "mesh",
      institutionName,
      institutionId: body.institution_id ? String(body.institution_id).trim() : null,
      meshIntegrationId: body.integration_id ? String(body.integration_id).trim() : null,
      meshAccountId: body.account_id ? String(body.account_id).trim() : null,
      status: "active"
    })

    return NextResponse.json({ success: true, connection })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save exchange connection"
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
}
