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
import type {
  SettlementDestinationAccountType,
  SettlementDestinationConnectedProvider,
  SettlementDestinationSource
} from "@/database/settlementDestinations"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type DestinationUpdatePayload = {
  label?: string
  exchangeName?: string
  asset?: string
  network?: string
  walletNetwork?: string
  address?: string
  memoOrTag?: string | null
  isDefault?: boolean
  accountType?: SettlementDestinationAccountType
  source?: SettlementDestinationSource
  connectedProvider?: SettlementDestinationConnectedProvider | null
  externalAccountName?: string | null
  externalAccountId?: string | null
  institutionName?: string | null
  lastVerifiedAt?: string | null
  personalExchangeAcknowledged?: boolean
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
      if (walletNetwork && network && walletNetwork.toLowerCase() !== network.toLowerCase()) {
        return errorResponse("Saved destination network must match the selected wallet network.", 400)
      }
      const dest = await createSettlementDestinationEngine(merchantId, {
        label:        String(body.label        || "").trim(),
        exchangeName: String(body.exchange_name || "").trim(),
        asset:        String(body.asset        || "").trim(),
        network,
        walletNetwork,
        address:      String(body.address      || "").trim(),
        memoOrTag:    body.memo_or_tag != null ? String(body.memo_or_tag).trim() : null,
        isDefault:    Boolean(body.is_default),
        accountType:  String(body.account_type || "external_wallet").trim() as SettlementDestinationAccountType,
        source:       String(body.source || "manual").trim() as SettlementDestinationSource,
        connectedProvider: body.connected_provider != null
          ? String(body.connected_provider).trim() as SettlementDestinationConnectedProvider
          : "manual",
        externalAccountName: body.external_account_name != null ? String(body.external_account_name).trim() : null,
        externalAccountId: body.external_account_id != null ? String(body.external_account_id).trim() : null,
        institutionName: body.institution_name != null ? String(body.institution_name).trim() : null,
        lastVerifiedAt: body.last_verified_at != null ? String(body.last_verified_at).trim() : null,
        personalExchangeAcknowledged: Boolean(body.personal_exchange_acknowledged)
      })

      const destinations = await getSettlementDestinationsEngine(merchantId)
      return NextResponse.json({ success: true, destination: dest, destinations })
    }

    if (action === "update") {
      const id = String(body.id || "").trim()
      if (!id) return errorResponse("id is required", 400)

      const update: DestinationUpdatePayload = {}
      if (body.label        !== undefined) update.label        = String(body.label).trim()
      if (body.exchange_name !== undefined) update.exchangeName = String(body.exchange_name).trim()
      if (body.asset        !== undefined) update.asset        = String(body.asset).trim()
      if (body.network      !== undefined) update.network      = String(body.network).trim()
      const walletNetwork = String(body.wallet_network || "").trim()
      if (walletNetwork) update.walletNetwork = walletNetwork
      if (walletNetwork && update.network && walletNetwork.toLowerCase() !== String(update.network).toLowerCase()) {
        return errorResponse("Saved destination network must match the selected wallet network.", 400)
      }
      if (body.address      !== undefined) update.address      = String(body.address).trim()
      if (body.memo_or_tag  !== undefined) update.memoOrTag    = body.memo_or_tag != null ? String(body.memo_or_tag).trim() : null
      if (body.is_default   !== undefined) update.isDefault    = Boolean(body.is_default)
      if (body.account_type !== undefined) update.accountType = String(body.account_type).trim() as SettlementDestinationAccountType
      if (body.source !== undefined) update.source = String(body.source).trim() as SettlementDestinationSource
      if (body.connected_provider !== undefined) update.connectedProvider = body.connected_provider != null ? String(body.connected_provider).trim() as SettlementDestinationConnectedProvider : null
      if (body.external_account_name !== undefined) update.externalAccountName = body.external_account_name != null ? String(body.external_account_name).trim() : null
      if (body.external_account_id !== undefined) update.externalAccountId = body.external_account_id != null ? String(body.external_account_id).trim() : null
      if (body.institution_name !== undefined) update.institutionName = body.institution_name != null ? String(body.institution_name).trim() : null
      if (body.last_verified_at !== undefined) update.lastVerifiedAt = body.last_verified_at != null ? String(body.last_verified_at).trim() : null
      if (body.personal_exchange_acknowledged !== undefined) {
        update.personalExchangeAcknowledged = Boolean(body.personal_exchange_acknowledged)
      }

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
