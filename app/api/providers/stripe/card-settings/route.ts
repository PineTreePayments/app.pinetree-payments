import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getStripeCardProviderContext, updateStripeCardSettingsEngine } from "@/engine/stripeConnect"

export async function GET(req: NextRequest) {
  try {
    const context = await getStripeCardProviderContext(await requireMerchantIdFromRequest(req))
    return NextResponse.json({ settings: context.settings, onlineCardsEnabled: context.onlineEnabled })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Card settings failed" }, { status: getRouteErrorStatus(error) }) }
}

export async function PATCH(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = await req.json()
    return NextResponse.json({ settings: await updateStripeCardSettingsEngine(merchantId, body) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Card settings failed" }, { status: getRouteErrorStatus(error) }) }
}
