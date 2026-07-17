import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { getStripeCardProviderContext, getStripeTerminalReadiness, updateStripeCardSettingsEngine } from "@/engine/stripeConnect"
import { isStripeTestMode } from "@/providers/stripe"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const [context, readiness] = await Promise.all([
      getStripeCardProviderContext(merchantId),
      getStripeTerminalReadiness(merchantId)
    ])
    return NextResponse.json({
      settings: context.settings,
      onlineCardsEnabled: context.onlineEnabled,
      readiness: { ready: readiness.ready, reason: readiness.ready ? null : readiness.reason },
      stripeTestMode: isStripeTestMode()
    })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Card settings failed" }, { status: getRouteErrorStatus(error) }) }
}

export async function PATCH(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = await req.json()
    return NextResponse.json({ settings: await updateStripeCardSettingsEngine(merchantId, body) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Card settings failed" }, { status: getRouteErrorStatus(error) }) }
}
