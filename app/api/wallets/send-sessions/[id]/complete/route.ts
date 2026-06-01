/**
 * POST /api/wallets/send-sessions/[id]/complete
 *
 * Called by the mobile approval page after a real tx_hash (Base) or
 * signature (Solana) has been obtained from the merchant's wallet.
 *
 * This endpoint:
 *   1. Validates the session exists and is not already terminal.
 *   2. Validates that a non-empty tx_hash (Base) or signature (Solana) is provided.
 *   3. Calls recordDirectSendSubmission to create the direct-send activity record.
 *   4. Marks the session as "submitted".
 *
 * Activity is NEVER created without a real on-chain identifier.
 * The session ID serves as implicit auth — UUIDs are unguessable.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  getSendSession,
  updateSendSessionStatus
} from "@/database/merchantWalletSendSessions"
import { recordDirectSendSubmission } from "@/engine/settlementWithdrawals"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(
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

  const txHashRaw   = body.tx_hash   != null ? String(body.tx_hash).trim()   : ""
  const signatureRaw = body.signature != null ? String(body.signature).trim() : ""

  try {
    const session = await getSendSession(id)
    if (!session) return errorResponse("Session not found", 404)

    // Prevent double-completion
    if (session.status === "submitted") {
      return NextResponse.json({ success: true, already_submitted: true })
    }

    // Reject already-terminal sessions
    const terminalStatuses = ["rejected", "failed", "expired"]
    if (terminalStatuses.includes(session.status)) {
      return errorResponse(`Session is already ${session.status}`, 400)
    }

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      await updateSendSessionStatus(id, "expired").catch(() => {})
      return errorResponse("Session has expired", 410)
    }

    // Determine on-chain proof by rail
    const isSolana = session.rail === "solana"
    const txHash   = isSolana ? (signatureRaw || txHashRaw) : txHashRaw
    const sig      = isSolana ? (signatureRaw || txHashRaw) : ""

    if (!txHash) {
      const required = isSolana ? "signature" : "tx_hash"
      return errorResponse(`${required} is required to complete the session`, 400)
    }

    // Basic format validation
    if (!isSolana && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return errorResponse("tx_hash must be a valid 0x-prefixed 64-hex-char EVM transaction hash", 400)
    }
    if (isSolana && txHash.length < 32) {
      return errorResponse("signature must be a valid base58 Solana transaction signature", 400)
    }

    // Determine destination_kind from prepared_payload metadata
    const destinationKindRaw = String(
      session.prepared_payload.destination_kind || ""
    ).trim()
    const destinationKind: "manual_address" | "saved_destination" =
      destinationKindRaw === "saved_destination" ? "saved_destination" : "manual_address"

    // Record the direct send activity (server-side, uses admin client)
    await recordDirectSendSubmission(session.merchant_id, {
      walletId:         session.wallet_id,
      asset:            session.asset,
      network:          session.network,
      amount:           session.amount,
      destinationAddress: session.destination_address,
      destinationLabel: session.destination_label,
      destinationKind,
      txHash,
    })

    // Mark session as submitted
    const updated = await updateSendSessionStatus(id, "submitted", {
      txHash: isSolana ? null : txHash,
      signature: isSolana ? sig : null,
    })

    return NextResponse.json({ success: true, session: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to complete session"

    // Attempt to mark session as failed for visibility
    await updateSendSessionStatus(id, "failed", { error: message }).catch(() => {})

    return errorResponse(message, 500)
  }
}
