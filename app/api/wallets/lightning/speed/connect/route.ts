/**
 * POST /api/wallets/lightning/speed/connect
 *
 * Connects or disconnects a merchant's Speed account.
 * action "connect": test credentials then save; returns sanitized status.
 * action "disconnect": remove Speed provider row; does NOT touch NWC.
 *
 * SECURITY:
 * - secretKey is a server-only secret. Never return it in any response.
 * - Credentials are saved with the DB helper which stores them server-side only.
 * - Use maskSpeedKey for all log statements.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  testSpeedConnection,
  maskSpeedKey
} from "@/providers/lightning/speedClient"
import {
  saveMerchantSpeedConnection,
  disconnectMerchantSpeedConnection,
  getMerchantSpeedProvider
} from "@/database/merchantProviders"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

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

  let body: {
    action?: string
    secretKey?: string
    publishableKey?: string
    accountId?: string
    webhookSecret?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const action = String(body.action || "connect").trim().toLowerCase()

  // ── Disconnect ────────────────────────────────────────────────────────────
  if (action === "disconnect") {
    await disconnectMerchantSpeedConnection(merchantId)
    console.info("[api/speed/connect] Speed connection disconnected", { merchantId })
    return NextResponse.json({
      success: true,
      connected: false,
      message: "Speed Lightning disconnected."
    })
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  const secretKey = String(body.secretKey || "").trim()
  if (!secretKey) {
    return NextResponse.json({ error: "secretKey is required" }, { status: 400 })
  }

  const publishableKey = String(body.publishableKey || "").trim() || undefined
  const accountId = String(body.accountId || "").trim() || undefined
  const webhookSecret = String(body.webhookSecret || "").trim() || undefined

  console.info("[api/speed/connect] Testing Speed credentials before save", {
    merchantId,
    keyMasked: maskSpeedKey(secretKey)
  })

  // Test credentials before saving — do not save if connection fails
  let connectionResult
  try {
    connectionResult = await testSpeedConnection(secretKey)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speed connection test failed"
    return NextResponse.json({
      success: false,
      error: `Connection test failed: ${message}`
    }, { status: 200 })
  }

  // Save the connection server-side — secret key never leaves the server
  try {
    const { providerRowId } = await saveMerchantSpeedConnection(merchantId, {
      secretKey,
      publishableKey,
      accountId: accountId || connectionResult.accountId || undefined,
      webhookSecret,
      mode: connectionResult.mode,
      accountStatus: "active"
    })

    console.info("[api/speed/connect] Speed connection saved", {
      merchantId,
      providerRowId,
      mode: connectionResult.mode,
      keyMasked: maskSpeedKey(secretKey)
    })

    const speedStatus = await getMerchantSpeedProvider(merchantId)

    return NextResponse.json({
      success: true,
      connected: true,
      mode: connectionResult.mode,
      accountId: connectionResult.accountId,
      notes: connectionResult.notes,
      speedStatus,
      message:
        connectionResult.mode === "test"
          ? "Speed connected in test mode. Switch to a live key when ready for production payments."
          : connectionResult.mode === "live"
            ? "Speed connected. Payment processing integration pending — this connection is for setup only."
            : "Speed connected. Payment processing integration pending."
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save Speed connection"
    console.error("[api/speed/connect] Save failed", { merchantId, error: message })
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

  const speedStatus = await getMerchantSpeedProvider(merchantId)

  return NextResponse.json({
    success: true,
    connected: Boolean(speedStatus),
    speedStatus: speedStatus || null
  })
}
