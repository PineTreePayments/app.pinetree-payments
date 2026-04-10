import { NextRequest, NextResponse } from "next/server"
import {
  getProvidersDashboardEngine,
  updateProviderSettingEngine,
  toggleProviderEngine,
  disconnectProviderEngine,
  saveProviderEngine
} from "@/lib/engine/providersDashboard"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const data = await getProvidersDashboardEngine(merchantId)
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load providers dashboard") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = await req.json()

    const action = String(body?.action || "")

    if (action === "updateSettings") {
      await updateProviderSettingEngine(
        merchantId,
        body.field,
        Boolean(body.value)
      )
    } else if (action === "toggleProvider") {
      await toggleProviderEngine(merchantId, String(body.provider || ""), Boolean(body.value))
    } else if (action === "disconnectProvider") {
      await disconnectProviderEngine(merchantId, String(body.provider || ""))
    } else if (action === "saveProvider") {
      await saveProviderEngine({
        merchantId,
        provider: String(body.provider || ""),
        walletAddress: body.walletAddress,
        walletType: body.walletType,
        apiKey: body.apiKey
      })
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }

    const data = await getProvidersDashboardEngine(merchantId)
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Providers action failed") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
