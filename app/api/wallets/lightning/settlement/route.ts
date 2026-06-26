import { type NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import {
  getLightningSettlementOverview,
  setLightningSettlementDestination,
} from "@/engine/lightningSettlement"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await getLightningSettlementOverview(merchantId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Lightning settlement"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const destinationType = String(body.destination_type || body.destinationType || "").trim()
    if (destinationType !== "pinetree_btc_wallet" && destinationType !== "external_btc_wallet") {
      return NextResponse.json({ error: "Unsupported payout destination type" }, { status: 400 })
    }

    const result = await setLightningSettlementDestination({
      merchantId,
      destinationType,
      destinationAddress: String(body.destination_address || body.destinationAddress || "").trim(),
      label: body.label != null ? String(body.label) : null,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save Lightning settlement"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
