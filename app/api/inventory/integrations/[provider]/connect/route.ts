import { NextRequest, NextResponse } from "next/server"
import { connectInventoryProvider } from "@/engine/inventory/integrations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { provider } = await context.params
    const result = await connectInventoryProvider(merchantId, provider)
    return NextResponse.json(result, {
      status: result.status === "REQUIRES_CONFIGURATION" ? 409 : 200
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect inventory provider"
    return NextResponse.json(
      { error: message },
      { status: message.includes("Unknown") ? 404 : getRouteErrorStatus(error) }
    )
  }
}
