/**
 * POST /api/wallets/send-sessions
 *
 * Creates a merchant wallet send approval session after prepare_direct has
 * produced the prepared transaction payload (tx_params or unsigned_tx_base64).
 *
 * The session encodes enough data for the mobile approval page to sign and
 * broadcast the transaction using the merchant's specific wallet app.
 * PineTree never stores or transmits private keys.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"
import { createSendSession } from "@/database/merchantWalletSendSessions"

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

  const walletId           = String(body.wallet_id          || "").trim()
  const rail               = String(body.rail               || "").trim().toLowerCase()
  const walletType         = String(body.wallet_type        || "").trim().toLowerCase()
  const walletAddress      = String(body.wallet_address     || "").trim()
  const asset              = String(body.asset              || "").trim().toUpperCase()
  const network            = String(body.network            || "").trim().toLowerCase()
  const destinationAddress = String(body.destination_address || "").trim()
  const destinationLabel   = body.destination_label != null ? String(body.destination_label).trim() : null
  const amount             = String(body.amount             || "").trim()
  const preparedPayload    = (body.prepared_payload as Record<string, unknown>) || {}

  if (!walletId)           return errorResponse("wallet_id is required", 400)
  if (!rail)               return errorResponse("rail is required", 400)
  if (!walletType)         return errorResponse("wallet_type is required", 400)
  if (!walletAddress)      return errorResponse("wallet_address is required", 400)
  if (!asset)              return errorResponse("asset is required", 400)
  if (!network)            return errorResponse("network is required", 400)
  if (!destinationAddress) return errorResponse("destination_address is required", 400)
  if (!amount)             return errorResponse("amount is required", 400)

  const allowedRails = ["base", "solana"]
  if (!allowedRails.includes(rail)) return errorResponse(`Unsupported rail: ${rail}`, 400)

  const allowedWalletTypes = ["base", "metamask", "trust", "phantom", "solflare"]
  if (!allowedWalletTypes.includes(walletType)) {
    return errorResponse(`Unsupported wallet_type: ${walletType}`, 400)
  }

  console.log("[send-session POST] creating", { merchantId, walletId, rail, walletType, asset, network })

  try {
    const session = await createSendSession({
      merchantId,
      walletId,
      rail,
      walletType,
      walletAddress,
      asset,
      network,
      destinationAddress,
      destinationLabel,
      amount,
      preparedPayload,
    })

    console.log("[send-session POST] created", { id: session.id, rail: session.rail, wallet_type: session.wallet_type, status: session.status, expires_at: session.expires_at })

    return NextResponse.json({ success: true, session })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create send session"
    console.error("[send-session POST] error", { merchantId, rail, walletType, message })
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
}
