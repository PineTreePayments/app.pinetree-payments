/**
 * POST /api/wallets/lightning/test
 *
 * Tests an NWC connection string by calling `get_info` on the wallet relay.
 * Returns the wallet's supported capabilities without returning the NWC URI.
 */

import { NextRequest, NextResponse } from "next/server"
import { testNwcConnection, validateNwcUri, maskNwcUri } from "@/providers/lightning/nwcClient"
import { getLightningNwcReadiness } from "@/database/merchantProviders"
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

  let body: { nwcUri?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const nwcUri = String(body.nwcUri || "").trim()
  if (!nwcUri) {
    return NextResponse.json({ error: "nwcUri is required" }, { status: 400 })
  }

  const { valid, error: parseError } = validateNwcUri(nwcUri)
  if (!valid) {
    return NextResponse.json({
      success: false,
      connected: false,
      ready: false,
      error: parseError || "Invalid NWC URI format"
    }, { status: 400 })
  }

  console.info("[api/lightning/test] Testing NWC connection", {
    merchantId,
    nwcMasked: maskNwcUri(nwcUri)
  })

  try {
    const capabilities = await testNwcConnection(nwcUri)
    const readiness = getLightningNwcReadiness(capabilities)

    return NextResponse.json({
      success: readiness.ready,
      connected: true,
      ready: readiness.ready,
      missingPermissions: readiness.missingPermissions,
      readinessReason: readiness.reason,
      canMakeInvoice: capabilities.canMakeInvoice,
      canLookupInvoice: capabilities.canLookupInvoice,
      canPayInvoice: capabilities.canPayInvoice,
      canCollectFee: readiness.ready,
      supportedMethods: capabilities.supportedMethods,
      walletAlias: capabilities.walletAlias,
      message: readiness.ready
        ? "Wallet ready. Invoice creation, invoice lookup, and PineTree service-fee collection are supported."
        : readiness.reason || "This wallet is connected but is not ready for live Bitcoin Lightning payments.",
      error: readiness.ready ? undefined : readiness.reason
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "NWC connection test failed"
    console.warn("[api/lightning/test] NWC test failed", {
      merchantId,
      error: message
    })

    return NextResponse.json({
      success: false,
      connected: false,
      ready: false,
      error: message
    }, { status: 200 })
  }
}
