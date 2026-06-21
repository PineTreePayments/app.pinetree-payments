import { NextRequest, NextResponse } from "next/server"
import {
  getSettingsDashboardEngine,
  saveSettingsDashboardEngine,
  type MerchantOperationsSettingsPayload,
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

async function save(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = (await req.json()) as {
      settings: MerchantSettingsPayload
      tax: MerchantTaxSettingsPayload
      operations: MerchantOperationsSettingsPayload
    }

    const current = await getSettingsDashboardEngine(merchantId)
    await saveSettingsDashboardEngine(
      merchantId,
      { ...current.settings, ...(body.settings || {}) },
      { ...current.tax, ...(body.tax || {}) },
      { ...current.operations, ...(body.operations || {}) }
    )
    const data = await getSettingsDashboardEngine(merchantId)

    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to save settings")
    const status = message.includes("migration required")
      ? 409
      : message.includes("must be") || message.includes("required") || message.includes("too long")
        ? 400
        : getRouteErrorStatus(error)
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}

export async function PATCH(req: NextRequest) {
  return save(req)
}

export async function POST(req: NextRequest) {
  return save(req)
}
