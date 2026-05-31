/**
 * Settlement Withdrawal API
 *
 * POST action="prepare"   — validate, build unsigned tx (Solana) or tx params (Base), create record
 * POST action="submit"    — record tx hash / signature after merchant signs
 * POST action="cancel"    — cancel a PREPARED / AWAITING_SIGNATURE withdrawal
 * GET                     — list withdrawal history for the authenticated merchant
 *
 * PineTree never stores private keys or signing material.
 * All fund movement is signed by the merchant's own wallet extension.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"
import {
  prepareSettlementWithdrawal,
  prepareDirectWalletTransfer,
  submitSettlementWithdrawal,
  recordDirectSendSubmission,
  cancelSettlementWithdrawal,
  checkSettlementWithdrawalStatus,
  getSettlementWithdrawalHistory
} from "@/engine/settlementWithdrawals"

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
    const url = new URL(req.url)
    const limit = Math.min(Number(url.searchParams.get("limit") || "20") || 20, 50)
    const withdrawals = await getSettlementWithdrawalHistory(merchantId, { limit })
    return NextResponse.json({ success: true, withdrawals })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load withdrawal history"
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
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

  const action = String(body.action || "").trim().toLowerCase()

  try {
    if (action === "prepare") {
      const settlementDestinationId = String(body.settlement_destination_id || "").trim()
      const walletId                 = body.wallet_id != null ? String(body.wallet_id).trim() : null
      const walletAddress            = String(body.wallet_address || "").trim()
      const walletNetwork            = String(body.wallet_network || "").trim()
      const amount                   = String(body.amount || "").trim()

      if (!settlementDestinationId) return errorResponse("settlement_destination_id is required", 400)
      if (!walletAddress)           return errorResponse("wallet_address is required", 400)
      if (!walletNetwork)           return errorResponse("wallet_network is required", 400)
      if (!amount)                  return errorResponse("amount is required", 400)

      const result = await prepareSettlementWithdrawal(merchantId, {
        settlementDestinationId,
        walletId,
        walletAddress,
        walletNetwork,
        amount
      })

      return NextResponse.json({
        success: true,
        withdrawal: result.withdrawal,
        unsigned_tx_base64: result.unsignedTxBase64 ?? null,
        tx_params: result.txParams ?? null
      })
    }

    if (action === "prepare_direct") {
      const walletId            = body.wallet_id != null ? String(body.wallet_id).trim() : null
      const walletAddress       = String(body.wallet_address || "").trim()
      const walletNetwork       = String(body.wallet_network || "").trim()
      const asset               = String(body.asset || "").trim()
      const destinationAddress  = String(body.destination_address || "").trim()
      const amount              = String(body.amount || "").trim()

      if (!walletAddress)      return errorResponse("wallet_address is required", 400)
      if (!walletNetwork)      return errorResponse("wallet_network is required", 400)
      if (!asset)              return errorResponse("asset is required", 400)
      if (!destinationAddress) return errorResponse("destination_address is required", 400)
      if (!amount)             return errorResponse("amount is required", 400)

      const result = await prepareDirectWalletTransfer(merchantId, {
        walletId,
        walletAddress,
        walletNetwork,
        asset,
        destinationAddress,
        amount
      })

      return NextResponse.json({
        success: true,
        transfer: result.transfer,
        unsigned_tx_base64: result.unsignedTxBase64 ?? null,
        tx_params: result.txParams ?? null
      })
    }

    if (action === "submit") {
      const id      = String(body.id || "").trim()
      const txHash  = String(body.tx_hash || "").trim()

      if (!id)      return errorResponse("id is required", 400)
      if (!txHash)  return errorResponse("tx_hash is required", 400)

      const withdrawal = await submitSettlementWithdrawal(merchantId, id, txHash)
      return NextResponse.json({ success: true, withdrawal })
    }

    if (action === "submit_direct") {
      const walletId            = body.wallet_id != null ? String(body.wallet_id).trim() : null
      const asset               = String(body.asset || "").trim()
      const network             = String(body.network || "").trim()
      const amount              = String(body.amount || "").trim()
      const destinationAddress  = String(body.destination_address || "").trim()
      const destinationLabel    = body.destination_label != null ? String(body.destination_label).trim() : null
      const destinationKindRaw  = String(body.destination_kind || "").trim()
      const txHash              = String(body.tx_hash || "").trim()

      if (!asset)              return errorResponse("asset is required", 400)
      if (!network)            return errorResponse("network is required", 400)
      if (!amount)             return errorResponse("amount is required", 400)
      if (!destinationAddress) return errorResponse("destination_address is required", 400)
      if (!txHash)             return errorResponse("tx_hash is required", 400)
      if (destinationKindRaw !== "manual_address" && destinationKindRaw !== "saved_destination") {
        return errorResponse("destination_kind must be manual_address or saved_destination", 400)
      }

      const withdrawal = await recordDirectSendSubmission(merchantId, {
        walletId,
        asset,
        network,
        amount,
        destinationAddress,
        destinationLabel,
        destinationKind: destinationKindRaw,
        txHash
      })

      return NextResponse.json({ success: true, withdrawal })
    }

    if (action === "cancel") {
      const id = String(body.id || "").trim()
      if (!id) return errorResponse("id is required", 400)

      const withdrawal = await cancelSettlementWithdrawal(merchantId, id)
      return NextResponse.json({ success: true, withdrawal })
    }

    if (action === "checkstatus") {
      const id = String(body.id || "").trim()
      if (!id) return errorResponse("id is required", 400)

      const { withdrawal, chainStatus } = await checkSettlementWithdrawalStatus(merchantId, id)
      return NextResponse.json({ success: true, withdrawal, chainStatus })
    }

    return errorResponse(`Unknown action: ${action}`, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed"
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
}
