/**
 * POST /api/wallets/lightning/speed/test
 *
 * Tests PineTree's server-side Speed platform credentials.
 * Does not accept merchant-owned Speed API keys.
 */

import { NextRequest, NextResponse } from "next/server"
import { testPineTreeSpeedConnection } from "@/providers/lightning/speedClient"
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

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (body && ("secretKey" in body || "publishableKey" in body || "webhookSecret" in body)) {
    return NextResponse.json(
      { error: "Merchant-owned Speed API keys are not accepted by the default Speed test." },
      { status: 400 }
    )
  }

  console.info("[api/speed/test] Testing PineTree Speed platform connection", { merchantId })

  try {
    const result = await testPineTreeSpeedConnection()

    return NextResponse.json({
      success: true,
      connected: result.connected,
      mode: result.mode,
      accountId: result.accountId,
      notes: result.notes,
      platformStatus: result.config
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speed platform connection test failed"
    console.warn("[api/speed/test] PineTree platform test failed", { merchantId, error: message })

    return NextResponse.json({
      success: false,
      connected: false,
      error: message
    }, { status: 200 })
  }
}
