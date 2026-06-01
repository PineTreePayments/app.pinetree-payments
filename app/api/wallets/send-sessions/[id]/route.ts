/**
 * GET  /api/wallets/send-sessions/[id]
 *   Returns public-safe session details for the mobile approval page.
 *   No merchant auth required — session ID is an unguessable UUID.
 *   Reads use the service role key to bypass RLS; no sensitive merchant
 *   data beyond what the approver needs is returned.
 *
 * PATCH /api/wallets/send-sessions/[id]
 *   Updates session status from the mobile approval page.
 *   Only non-terminal status transitions are allowed via this endpoint.
 *   Setting tx_hash / signature / submitted requires the /complete endpoint.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  getSendSession,
  updateSendSessionStatus,
  type SendSessionStatus
} from "@/database/merchantWalletSendSessions"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

// Status values the mobile page is allowed to set via PATCH.
// Terminal statuses (submitted, rejected, failed, expired) and "approved" are
// gated: approved is set en-route to complete; submitted requires /complete.
const MOBILE_SETTABLE_STATUSES: SendSessionStatus[] = [
  "opened",
  "wallet_connecting",
  "wallet_connected",
  "approval_requested",
  "rejected",
  "failed",
  "expired",
]

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params
  if (!id) return errorResponse("Session ID is required", 400)

  console.log("[send-session GET]", { id })

  try {
    const session = await getSendSession(id)

    if (!session) {
      console.warn("[send-session GET] no session found", { id })
      return errorResponse("Approval session not found. It may have expired or the link may be invalid.", 404)
    }

    console.log("[send-session GET] found", { id, status: session.status, rail: session.rail, wallet_type: session.wallet_type, expires_at: session.expires_at })

    // Check expiry (belt-and-suspenders; DB index handles cleanup)
    if (session.status === "created" || session.status === "opened") {
      if (new Date(session.expires_at) < new Date()) {
        await updateSendSessionStatus(id, "expired").catch(() => {})
        return errorResponse("Approval session has expired. Return to PineTree and create a new QR.", 410)
      }
    }

    // Return only fields the approval page needs
    return NextResponse.json({
      success: true,
      session: {
        id:                  session.id,
        rail:                session.rail,
        wallet_type:         session.wallet_type,
        wallet_address:      session.wallet_address,
        asset:               session.asset,
        network:             session.network,
        destination_address: session.destination_address,
        destination_label:   session.destination_label,
        amount:              session.amount,
        prepared_payload:    session.prepared_payload,
        status:              session.status,
        tx_hash:             session.tx_hash,
        signature:           session.signature,
        error:               session.error,
        expires_at:          session.expires_at,
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load session"
    console.error("[send-session GET] error", { id, message })
    return errorResponse(`Could not load approval session: ${message}`, 500)
  }
}

export async function PATCH(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params
  if (!id) return errorResponse("Session ID is required", 400)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse("Invalid request body", 400)
  }

  const status = String(body.status || "").trim() as SendSessionStatus
  const error  = body.error != null ? String(body.error).trim() : undefined

  if (!status) return errorResponse("status is required", 400)
  if (!MOBILE_SETTABLE_STATUSES.includes(status)) {
    return errorResponse(`Status '${status}' cannot be set via this endpoint`, 400)
  }

  try {
    const existing = await getSendSession(id)
    if (!existing) return errorResponse("Session not found", 404)

    // Prevent updating already-terminal sessions
    const terminalStatuses: SendSessionStatus[] = ["submitted", "rejected", "failed", "expired"]
    if (terminalStatuses.includes(existing.status)) {
      return NextResponse.json({ success: true, session: existing })
    }

    const updated = await updateSendSessionStatus(id, status, { error })
    return NextResponse.json({ success: true, session: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update session"
    console.error("[send-session PATCH] error", { id, status, message })
    return errorResponse(message, 500)
  }
}
