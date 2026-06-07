import { NextRequest, NextResponse } from "next/server"
import { syncInventoryProvider } from "@/engine/inventory/integrations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { provider } = await context.params
    return NextResponse.json(await syncInventoryProvider(merchantId, provider))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync inventory provider"
    return NextResponse.json(
      { error: message },
      { status: message.includes("configuration") ? 409 : message.includes("Unknown") ? 404 : getRouteErrorStatus(error) }
    )
  }
}
