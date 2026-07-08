import { NextRequest, NextResponse } from "next/server"
import { startStripeConnectOnboarding } from "@/engine/stripeConnect"
import { assertMerchantBusinessProfileComplete } from "@/engine/businessProfile"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    await assertMerchantBusinessProfileComplete(merchantId)
    const result = await startStripeConnectOnboarding({ merchantId })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 })
    }

    return NextResponse.json({ url: result.url })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
