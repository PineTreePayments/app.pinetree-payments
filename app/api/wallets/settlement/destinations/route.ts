/**
 * GET  /api/wallets/settlement/destinations
 *   List all exchange destinations for the authenticated merchant.
 *
 * POST /api/wallets/settlement/destinations
 *   action: "create"     — save a new exchange destination
 *   action: "update"     — update an existing destination
 *   action: "delete"     — delete a destination
 *   action: "setDefault" — mark a destination as default
 *
 * Exchange destinations are SETTLEMENT addresses only.
 * They are NEVER used as payment acceptance addresses.
 * PineTree never stores private keys, passwords, or exchange API credentials here.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"
import {
  getSettlementDestinationsEngine,
  createSettlementDestinationEngine,
  updateSettlementDestinationEngine,
  deleteSettlementDestinationEngine,
  setDefaultSettlementDestinationEngine,
  SETTLEMENT_ASSET_OPTIONS,
  SETTLEMENT_EXCHANGE_OPTIONS
} from "@/engine/settlementDestinations"

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
    const destinations = await getSettlementDestinationsEngine(merchantId)
    return NextResponse.json({
      success: true,
      destinations,
      assetOptions: SETTLEMENT_ASSET_OPTIONS,
      exchangeOptions: SETTLEMENT_EXCHANGE_OPTIONS
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load destinations"
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
    if (action === "create") {
      const network = String(body.network || "").trim()
      const walletNetwork = String(body.wallet_network || "").trim()
      if (walletNetwork && network && walletNetwork !== network) {
        return errorResponse("Saved destination network must match the selected wallet network.", 400)
      }
      const dest = await createSettlementDestinationEngine(merchantId, {
        label:        String(body.label        || "").trim(),
        exchangeName: String(body.exchange_name || "").trim(),
        asset:        String(body.asset        || "").trim(),
        network,
        address:      String(body.address      || "").trim(),
        memoOrTag:    body.memo_or_tag != null ? String(body.memo_or_tag).trim() : null,
        isDefault:    Boolean(body.is_default)
      })

      const destinations = await getSettlementDestinationsEngine(merchantId)
      return NextResponse.json({ success: true, destination: dest, destinations })
    }

    if (action === "update") {
      const id = String(body.id || "").trim()
      if (!id) return errorResponse("id is required", 400)

      const update: Record<string, unknown> = {}
      if (body.label        !== undefined) update.label        = String(body.label).trim()
      if (body.exchange_name !== undefined) update.exchangeName = String(body.exchange_name).trim()
      if (body.asset        !== undefined) update.asset        = String(body.asset).trim()
      if (body.network      !== undefined) update.network      = String(body.network).trim()
      const walletNetwork = String(body.wallet_network || "").trim()
      if (walletNetwork && update.network && walletNetwork !== update.network) {
        return errorResponse("Saved destination network must match the selected wallet network.", 400)
      }
      if (body.address      !== undefined) update.address      = String(body.address).trim()
      if (body.memo_or_tag  !== undefined) update.memoOrTag    = body.memo_or_tag != null ? String(body.memo_or_tag).trim() : null
      if (body.is_default   !== undefined) update.isDefault    = Boolean(body.is_default)

      const dest = await updateSettlementDestinationEngine(merchantId, id, update)
      const destinations = await getSettlementDestinationsEngine(merchantId)
      return NextResponse.json({ success: true, destination: dest, destinations })
    }

    if (action === "delete") {
      const id = String(body.id || "").trim()
      if (!id) return errorResponse("id is required", 400)

      await deleteSettlementDestinationEngine(merchantId, id)
      const destinations = await getSettlementDestinationsEngine(merchantId)
      return NextResponse.json({ success: true, destinations })
    }

    if (action === "setDefault") {
      const id = String(body.id || "").trim()
      if (!id) return errorResponse("id is required", 400)

      const destinations = await setDefaultSettlementDestinationEngine(merchantId, id)
      return NextResponse.json({ success: true, destinations })
    }

    return errorResponse(`Unknown action: ${action}`, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed"
    return errorResponse(message, getRouteErrorStatus(err, 500))
  }
}
