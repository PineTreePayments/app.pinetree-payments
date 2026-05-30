/**
 * POST /api/wallets/lightning/speed/test
 *
 * Tests a merchant's Speed secret API key against the Speed API.
 * Accepts: secretKey (required), publishableKey (optional), webhookSecret (optional)
 *
 * Returns sanitized connection status only — never echoes the secret key back.
 *
 * SECURITY: The secretKey is a server-only secret. Never log it or include it
 * in any response. Use maskSpeedKey for all log statements.
 */

import { NextRequest, NextResponse } from "next/server"
import { testSpeedConnection, maskSpeedKey } from "@/providers/lightning/speedClient"
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

  let body: { secretKey?: string; publishableKey?: string; webhookSecret?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const secretKey = String(body.secretKey || "").trim()
  if (!secretKey) {
    return NextResponse.json({ error: "secretKey is required" }, { status: 400 })
  }

  console.info("[api/speed/test] Testing Speed connection", {
    merchantId,
    keyMasked: maskSpeedKey(secretKey)
  })

  try {
    const result = await testSpeedConnection(secretKey)

    return NextResponse.json({
      success: true,
      connected: result.connected,
      mode: result.mode,
      accountId: result.accountId,
      notes: result.notes
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speed connection test failed"
    console.warn("[api/speed/test] Test failed", {
      merchantId,
      keyMasked: maskSpeedKey(secretKey),
      error: message
    })

    return NextResponse.json({
      success: false,
      connected: false,
      error: message
    }, { status: 200 })
  }
}
