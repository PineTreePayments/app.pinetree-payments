/**
 * POST /api/wallets/lightning/test
 *
 * Tests an NWC connection string by calling `get_info` on the wallet relay.
 * Returns the wallet's supported capabilities.
 *
 * Thin API layer — all logic is in providers/lightning/nwcClient.ts.
 * The NWC URI is NEVER logged or returned after this request.
 */

import { NextRequest, NextResponse } from "next/server"
import { testNwcConnection, validateNwcUri, maskNwcUri } from "@/providers/lightning/nwcClient"
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
      error: parseError || "Invalid NWC URI format"
    }, { status: 400 })
  }

  console.info("[api/lightning/test] Testing NWC connection", {
    merchantId,
    nwcMasked: maskNwcUri(nwcUri)
  })

  try {
    const capabilities = await testNwcConnection(nwcUri)

    const canCollectFee = capabilities.canMakeInvoice && capabilities.canPayInvoice

    if (!capabilities.canMakeInvoice) {
      return NextResponse.json({
        success: false,
        connected: true,
        canMakeInvoice: false,
        canPayInvoice: capabilities.canPayInvoice,
        canCollectFee: false,
        supportedMethods: capabilities.supportedMethods,
        walletAlias: capabilities.walletAlias,
        error: "This wallet cannot create invoices — PineTree Lightning requires make_invoice permission."
      }, { status: 200 })
    }

    return NextResponse.json({
      success: true,
      connected: true,
      canMakeInvoice: capabilities.canMakeInvoice,
      canLookupInvoice: capabilities.canLookupInvoice,
      canPayInvoice: capabilities.canPayInvoice,
      canCollectFee,
      supportedMethods: capabilities.supportedMethods,
      walletAlias: capabilities.walletAlias,
      message: canCollectFee
        ? "Wallet connected. Invoice creation and PineTree fee handling are supported."
        : "Wallet connected. Invoice creation is supported. Automatic fee collection requires pay_invoice permission."
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
      error: message
    }, { status: 200 })
  }
}
