import { NextRequest, NextResponse } from "next/server"
import {
  getSettingsDashboardEngine,
  saveSettingsDashboardEngine,
  type MerchantSettingsPayload,
  type MerchantTaxSettingsPayload
} from "@/engine/settingsDashboard"
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

    const data = await getSettingsDashboardEngine(merchantId)
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load settings") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = (await req.json()) as {
      settings: MerchantSettingsPayload
      tax: MerchantTaxSettingsPayload
    }

    await saveSettingsDashboardEngine(merchantId, body.settings, body.tax)
    const data = await getSettingsDashboardEngine(merchantId)

    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to save settings") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
