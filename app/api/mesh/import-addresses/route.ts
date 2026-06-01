/**
 * POST /api/mesh/import-addresses
 * Fetches deposit addresses from Mesh for the selected assets and imports them
 * as PineTree saved destinations for the authenticated merchant.
 *
 * The Mesh SDK access token is passed from the client (short-lived, not stored).
 * Server validates merchant ownership of the connection and enforces wallet
 * network context before making any Mesh API calls.
 *
 * Mesh imports exchange deposit addresses.
 * PineTree Send still prepares transfers for wallet approval.
 * Mesh managed transfers are not enabled.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getMeshDepositAddresses, isMeshConfigured } from "@/engine/mesh"
import { getMeshConnection, updateMeshConnectionSyncedAt } from "@/database/meshConnections"
import {
  listSettlementDestinations,
  createSettlementDestination,
  updateSettlementDestination
} from "@/database/settlementDestinations"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

// Permitted asset+network combinations per wallet context.
// Server enforces this — client selection is only UX; the server re-validates.
const ALLOWED_IMPORTS: Record<string, Array<{ asset: string; network: string }>> = {
  solana: [
    { asset: "SOL",  network: "solana" },
    { asset: "USDC", network: "solana" }
  ],
  base: [
    { asset: "ETH",  network: "base" },
    { asset: "USDC", network: "base" }
  ]
}

function isAllowed(asset: string, network: string, walletNetwork: string): boolean {
  return (ALLOWED_IMPORTS[walletNetwork] || []).some(
    (opt) =>
      opt.asset.toUpperCase() === asset.toUpperCase() &&
      opt.network.toLowerCase() === network.toLowerCase()
  )
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse("Invalid request body", 400)
  }

  const connectionId   = String(body.connection_id   || "").trim()
  const accessToken    = String(body.access_token     || "").trim()
  const walletNetwork  = String(body.wallet_network   || "").trim().toLowerCase()
  const institutionName = String(body.institution_name || "").trim()

  const rawAssets = Array.isArray(body.assets) ? body.assets : []
  const assets = (rawAssets as unknown[]).map((a) => ({
    asset:   String((a as Record<string, unknown>).asset   || "").trim().toUpperCase(),
    network: String((a as Record<string, unknown>).network || "").trim().toLowerCase()
  }))

  if (!connectionId)   return errorResponse("connection_id is required", 400)
  if (!accessToken)    return errorResponse("access_token is required", 400)
  if (!walletNetwork || !["solana", "base"].includes(walletNetwork)) {
    return errorResponse("wallet_network must be 'solana' or 'base'", 400)
  }
  if (assets.length === 0) return errorResponse("At least one asset must be selected", 400)

  // Validate each asset against the wallet context before any Mesh API calls
  for (const { asset, network } of assets) {
    if (!isAllowed(asset, network, walletNetwork)) {
      return errorResponse(
        `${asset} on ${network} is not permitted for a ${walletNetwork} wallet. ` +
        `Only ${(ALLOWED_IMPORTS[walletNetwork] || []).map((o) => `${o.asset} on ${o.network}`).join(" or ")} allowed.`,
        400
      )
    }
  }

  // Verify this connection belongs to the authenticated merchant
  const connection = await getMeshConnection(merchantId, connectionId).catch(() => null)
  if (!connection) return errorResponse("Exchange connection not found", 404)

  const now = new Date().toISOString()
  const existingDestinations = await listSettlementDestinations(merchantId)

  let imported = 0
  let updated  = 0
  const errors: string[] = []

  for (const { asset, network } of assets) {
    try {
      const addresses = await getMeshDepositAddresses(accessToken, asset, network)

      for (const addr of addresses) {
        if (!addr.address) continue

        // Duplicate check: same merchant + asset + network + address
        const existing = existingDestinations.find(
          (d) =>
            d.asset.toUpperCase()   === asset.toUpperCase() &&
            d.network.toLowerCase() === network.toLowerCase() &&
            d.address.toLowerCase() === addr.address.toLowerCase()
        )

        if (existing) {
          // Refresh Mesh metadata and verification timestamp without overwriting the label
          await updateSettlementDestination({
            merchantId,
            id: existing.id,
            source: "mesh",
            connectedProvider: "mesh",
            institutionName: institutionName || existing.institution_name || null,
            lastVerifiedAt: now
          })
          updated++
        } else {
          const networkDisplay = network.charAt(0).toUpperCase() + network.slice(1)
          const label = institutionName
            ? `${institutionName} ${asset} on ${networkDisplay}`
            : `${asset} on ${networkDisplay}`

          await createSettlementDestination({
            merchantId,
            label,
            exchangeName: institutionName || "Exchange",
            asset,
            network,
            address: addr.address,
            memoOrTag: addr.memo || addr.tag || null,
            isDefault: false,
            accountType: "business_exchange",
            source: "mesh",
            connectedProvider: "mesh",
            externalAccountId: connection.mesh_account_id || null,
            institutionName:   institutionName || null,
            lastVerifiedAt:    now
          })
          imported++
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to fetch ${asset} on ${network}`
      errors.push(msg)
    }
  }

  // Mark the connection as synced even if some individual assets failed
  await updateMeshConnectionSyncedAt(merchantId, connectionId).catch(() => {})

  // Return the refreshed destination list so the UI can update immediately
  const destinations = await listSettlementDestinations(merchantId)

  return NextResponse.json({
    success: true,
    imported,
    updated,
    errors,
    destinations
  })
}
