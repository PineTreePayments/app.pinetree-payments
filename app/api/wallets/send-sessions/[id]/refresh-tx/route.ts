/**
 * POST /api/wallets/send-sessions/[id]/refresh-tx
 *
 * Rebuilds the unsigned Solana transaction with a fresh blockhash.
 * Called from the mobile approval page after Phantom/Solflare connect
 * completes, just before building the signing deeplink URL.
 *
 * Why: Solana blockhashes expire after ~75 seconds. The unsigned tx is
 * built at prepare_direct time (desktop). By the time the merchant scans
 * the QR, connects the wallet, and taps approve, the blockhash may be
 * expired and Phantom/Solflare will reject the transaction.
 *
 * No merchant auth required — session UUID is the access token.
 * Only works for Solana sessions that have an unsigned_tx_base64 payload.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  getSendSession,
  updateSendSessionPreparedPayload,
} from "@/database/merchantWalletSendSessions"
import { buildSolanaWithdrawalUnsignedTx } from "@/engine/settlementWithdrawals"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params
  if (!id) return errorResponse("Session ID is required", 400)

  console.log("[refresh-tx POST] request", { id })

  try {
    const session = await getSendSession(id)
    if (!session) return errorResponse("Session not found", 404)

    const terminalStatuses = ["submitted", "rejected", "failed", "expired"]
    if (terminalStatuses.includes(session.status)) {
      return errorResponse(`Session is already ${session.status}`, 400)
    }

    if (new Date(session.expires_at) < new Date()) {
      return errorResponse("Session has expired", 410)
    }

    if (session.rail !== "solana") {
      return errorResponse("refresh-tx is only supported for Solana sessions", 400)
    }

    if (!session.prepared_payload.unsigned_tx_base64) {
      return errorResponse("Session does not have an unsigned Solana transaction", 400)
    }

    console.log("[refresh-tx POST] rebuilding unsigned tx", {
      id,
      wallet_address: session.wallet_address,
      destination_address: session.destination_address,
      asset: session.asset,
      amount: session.amount,
    })

    const freshTxBase64 = await buildSolanaWithdrawalUnsignedTx(
      session.wallet_address,
      session.destination_address,
      session.asset,
      session.amount
    )

    const updatedPayload: Record<string, unknown> = {
      ...session.prepared_payload,
      unsigned_tx_base64: freshTxBase64,
    }

    await updateSendSessionPreparedPayload(id, updatedPayload)

    console.log("[refresh-tx POST] done", { id, txLength: freshTxBase64.length })

    return NextResponse.json({ success: true, unsigned_tx_base64: freshTxBase64 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh transaction"
    console.error("[refresh-tx POST] error", { id, message })
    return errorResponse(message, 500)
  }
}
