import { NextRequest, NextResponse } from "next/server"
import { listInventoryIntegrationStatuses } from "@/engine/inventory/integrations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    return NextResponse.json({
      integrations: await listInventoryIntegrationStatuses(merchantId)
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load inventory integrations" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
