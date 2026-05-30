/**
 * POST /api/wallets/lightning/connect
 *
 * Saves a verified NWC connection for the authenticated merchant.
 * Accepts: nwcUri, walletLabel, action ("connect" | "disconnect")
 *
 * SECURITY:
 * - NWC URI contains a private key (secret field). Never return it to the client.
 * - URI is stored in merchant_providers.credentials (JSONB) server-side only.
 * - Only the engine layer reads the URI. API/UI get status only.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  testNwcConnection,
  validateNwcUri,
  maskNwcUri
} from "@/providers/lightning/nwcClient"
import {
  saveMerchantNwcConnection,
  disconnectMerchantNwc,
  getMerchantNwcStatus,
  getLightningNwcReadiness
} from "@/database/merchantProviders"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: getRouteErrorStatus(err) }
    )
  }

  let body: { nwcUri?: string; walletLabel?: string; action?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const action = String(body.action || "connect").trim().toLowerCase()

  // ── Disconnect ────────────────────────────────────────────────────────────
  if (action === "disconnect") {
    await disconnectMerchantNwc(merchantId)
    return NextResponse.json({
      success: true,
      connected: false,
      message: "Lightning wallet disconnected."
    })
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  const nwcUri = String(body.nwcUri || "").trim()
  const walletLabel = String(body.walletLabel || "Lightning Wallet").trim().slice(0, 100)

  if (!nwcUri) {
    return NextResponse.json({ error: "nwcUri is required" }, { status: 400 })
  }

  const { valid, error: parseError } = validateNwcUri(nwcUri)
  if (!valid) {
    return NextResponse.json({ error: parseError || "Invalid NWC URI" }, { status: 400 })
  }

  console.info("[api/lightning/connect] Verifying NWC connection before save", {
    merchantId,
    walletLabel,
    nwcMasked: maskNwcUri(nwcUri)
  })

  // Test the connection and get capabilities before saving
  let capabilities
  try {
    capabilities = await testNwcConnection(nwcUri)
  } catch (err) {
    const message = err instanceof Error ? err.message : "NWC connection test failed"
    return NextResponse.json({
      success: false,
      error: `Could not connect to wallet: ${message}`
    }, { status: 200 })
  }

  const readiness = getLightningNwcReadiness(capabilities)

  // Save the connection — nwcUri is stored server-side only
  try {
    const { providerRowId } = await saveMerchantNwcConnection(
      merchantId,
      nwcUri,
      walletLabel,
      capabilities
    )

    console.info("[api/lightning/connect] NWC connection saved", {
      merchantId,
      providerRowId,
      walletLabel,
      canMakeInvoice: capabilities.canMakeInvoice,
      canLookupInvoice: capabilities.canLookupInvoice,
      canPayInvoice: capabilities.canPayInvoice
    })

    const nwcStatus = await getMerchantNwcStatus(merchantId)

    return NextResponse.json({
      success: true,
      connected: true,
      ready: readiness.ready,
      missingPermissions: readiness.missingPermissions,
      readinessReason: readiness.reason,
      walletLabel,
      canMakeInvoice: capabilities.canMakeInvoice,
      canLookupInvoice: capabilities.canLookupInvoice,
      canPayInvoice: capabilities.canPayInvoice,
      canCollectFee: readiness.ready,
      walletAlias: capabilities.walletAlias,
      nwcStatus,
      message: readiness.ready
        ? "Lightning wallet connected and ready for live payments."
        : "Lightning wallet saved, but live payments are unavailable until the missing NWC permissions are granted."
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save wallet connection"
    console.error("[api/lightning/connect] Save failed", { merchantId, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: getRouteErrorStatus(err) }
    )
  }

  const nwcStatus = await getMerchantNwcStatus(merchantId)

  return NextResponse.json({
    success: true,
    connected: Boolean(nwcStatus),
    nwcStatus: nwcStatus || null
  })
}
