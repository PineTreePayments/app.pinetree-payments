/**
 * /api/wallets/lightning/speed/connect
 *
 * Default Speed uses PineTree's Speed platform account.
 * Merchants do not submit Speed API keys here.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  getPineTreeSpeedConfigStatus,
  testPineTreeSpeedConnection
} from "@/providers/lightning/speedClient"
import {
  saveMerchantSpeedConnection,
  disconnectMerchantSpeedConnection,
  getMerchantSpeedProvider
} from "@/database/merchantProviders"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

type SpeedConnectBody = {
  action?: string
  speedAccountId?: string
  speedAccountStatus?: string
  payoutDestination?: string
  payoutType?: string
  setupStatus?: string
  notes?: string[]
}

function sanitizeOptionalString(value: unknown): string | undefined {
  const trimmed = String(value || "").trim()
  return trimmed || undefined
}

function speedConnectErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Failed to save Speed setup"
  const normalized = message.toLowerCase()

  if (
    normalized.includes("merchant_providers") &&
    normalized.includes("updated_at") &&
    (normalized.includes("schema cache") ||
      normalized.includes("could not find") ||
      normalized.includes("column"))
  ) {
    return "merchant_providers.updated_at is missing. Run the migration to add updated_at and reload the Supabase schema cache."
  }

  return message
}

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

  let body: SpeedConnectBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const action = String(body.action || "connect").trim().toLowerCase()
  const rawBody = body as Record<string, unknown>

  if ("secretKey" in rawBody || "publishableKey" in rawBody || "webhookSecret" in rawBody) {
    return NextResponse.json(
      { error: "Merchant-owned Speed API keys are not accepted by the default Speed setup." },
      { status: 400 }
    )
  }

  if (action === "disconnect") {
    await disconnectMerchantSpeedConnection(merchantId)
    console.info("[api/speed/connect] Speed settlement setup cleared", { merchantId })
    return NextResponse.json({
      success: true,
      connected: false,
      platformStatus: getPineTreeSpeedConfigStatus(),
      speedStatus: null,
      message: "Speed settlement setup cleared. PineTree platform credentials were not changed."
    })
  }

  const platformStatus = getPineTreeSpeedConfigStatus()
  const speedAccountId = sanitizeOptionalString(body.speedAccountId)
  if (!speedAccountId) {
    return NextResponse.json(
      { error: "Merchant Speed Account ID is required for Speed Lightning payments." },
      { status: 400 }
    )
  }

  try {
    const platformTest = await testPineTreeSpeedConnection()
    const { providerRowId } = await saveMerchantSpeedConnection(merchantId, {
      accountId: speedAccountId,
      accountStatus: sanitizeOptionalString(body.speedAccountStatus) || "configured",
      payoutDestination: sanitizeOptionalString(body.payoutDestination),
      payoutType: sanitizeOptionalString(body.payoutType),
      setupStatus: sanitizeOptionalString(body.setupStatus) || "ready_for_payments",
      mode: platformStatus.mode,
      notes: Array.isArray(body.notes) ? body.notes.map(String).filter(Boolean) : [
        "PineTree Speed platform test passed.",
        "Merchant Speed account ID configured for split settlement."
      ],
      enabled: platformTest.connected && platformTest.config.paymentProcessingLive
    })

    console.info("[api/speed/connect] Speed settlement setup saved", {
      merchantId,
      providerRowId,
      providerModel: "pine_tree_speed_platform"
    })

    const speedStatus = await getMerchantSpeedProvider(merchantId)

    return NextResponse.json({
      success: true,
      connected: true,
      mode: platformStatus.mode,
      platformStatus,
      speedStatus,
      message: "Speed Lightning setup saved. PineTree can create Speed Lightning payments for this merchant."
    })
  } catch (err) {
    const message = speedConnectErrorMessage(err)
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

  const [speedStatus, platformStatus] = await Promise.all([
    getMerchantSpeedProvider(merchantId),
    Promise.resolve(getPineTreeSpeedConfigStatus())
  ])

  return NextResponse.json({
    success: true,
    connected: Boolean(speedStatus),
    platformStatus,
    speedStatus: speedStatus || null
  })
}
