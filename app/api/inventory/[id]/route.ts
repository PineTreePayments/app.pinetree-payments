import { NextRequest, NextResponse } from "next/server"
import {
  deleteInventoryItemEngine,
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
    const body = await req.json() as Record<string, unknown>
    const item = await updateInventoryItemEngine(merchantId, id, body)
    return NextResponse.json({ item })
  } catch (error) {
    const errorMessage = message(error)
    const status = errorMessage.includes("not found") ? 404 :
      errorMessage.includes("required") ||
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
    const item = await deleteInventoryItemEngine(merchantId, id)
    return NextResponse.json({ item })
  } catch (error) {
    const errorMessage = message(error)
    return NextResponse.json(
      { error: errorMessage },
      { status: errorMessage.includes("not found") ? 404 : getRouteErrorStatus(error) }
    )
  }
}
