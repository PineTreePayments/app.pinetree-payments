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
import {
  recordDirectSendSubmission,
  submitSignedSolanaTransaction,
} from "@/engine/settlementWithdrawals"

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

  const txHashRaw    = body.tx_hash   != null ? String(body.tx_hash).trim()   : ""
  const signatureRaw = body.signature != null ? String(body.signature).trim() : ""
  // signed_tx: base58-encoded signed Solana transaction returned by Phantom/Solflare
  // signTransaction deeplink — must be submitted to Solana RPC to get the signature.
  const signedTxRaw  = body.signed_tx  != null ? String(body.signed_tx).trim()  : ""

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

    // For Solana with a signed_tx (signTransaction deeplink): submit to RPC first
    let resolvedSignature = isSolana ? (signatureRaw || txHashRaw) : ""
    if (isSolana && signedTxRaw && !resolvedSignature) {
      try {
        resolvedSignature = await submitSignedSolanaTransaction(signedTxRaw)
        console.log("[complete] signed_tx submitted to Solana RPC", { id, signaturePrefix: resolvedSignature.slice(0, 10) })
      } catch (rpcErr) {
        const rpcMsg = rpcErr instanceof Error ? rpcErr.message : "Solana RPC submission failed"
        console.error("[complete] signed_tx RPC error", { id, error: rpcMsg })
        return errorResponse(`Failed to submit transaction to Solana: ${rpcMsg}`, 500)
      }
    }

    const txHash = isSolana ? resolvedSignature : txHashRaw
    const sig    = isSolana ? resolvedSignature : ""

    if (!txHash) {
      const required = isSolana ? "signature or signed_tx" : "tx_hash"
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

    // ── Concurrent-completion guard ───────────────────────────────────────────
    // Re-read the session immediately before writing to catch the most common
    // race: two concurrent requests both passed the status check above but only
    // one should record the activity.  This is a best-effort code-level guard;
    // the authoritative fix is a DB UNIQUE constraint on session_id in the
    // activity table (migration proposed in docs — not yet applied).
    const sessionBeforeWrite = await getSendSession(id)
    if (sessionBeforeWrite?.status === "submitted") {
      return NextResponse.json({ success: true, already_submitted: true })
    }

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
