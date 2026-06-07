import { NextRequest, NextResponse } from "next/server"
import {
  createInventoryItemEngine,
  getInventoryEngine
} from "@/engine/inventory"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function message(error: unknown) {
  return error instanceof Error ? error.message : "Inventory request failed"
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    return NextResponse.json(await getInventoryEngine(merchantId))
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const item = await createInventoryItemEngine(merchantId, await req.json())
    return NextResponse.json({ item }, { status: 201 })
  } catch (error) {
    const errorMessage = message(error)
    const status = errorMessage.includes("required") ||
      errorMessage.includes("must be") ||
      errorMessage.includes("too long") ? 400 : getRouteErrorStatus(error)
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
