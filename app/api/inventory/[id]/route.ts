import { NextRequest, NextResponse } from "next/server"
import {
  archiveInventoryItemEngine,
  updateInventoryItemEngine
} from "@/engine/inventory"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function message(error: unknown) {
  return error instanceof Error ? error.message : "Inventory request failed"
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await context.params
    const item = await updateInventoryItemEngine(merchantId, id, await req.json())
    return NextResponse.json({ item })
  } catch (error) {
    const errorMessage = message(error)
    const status = errorMessage.includes("required") ||
      errorMessage.includes("must be") ||
      errorMessage.includes("too long") ? 400 : getRouteErrorStatus(error)
    return NextResponse.json({ error: errorMessage }, { status })
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const { id } = await context.params
    const item = await archiveInventoryItemEngine(merchantId, id)
    return NextResponse.json({ item })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}
