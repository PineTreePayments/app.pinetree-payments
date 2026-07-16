import { NextRequest, NextResponse } from "next/server"
import { createStripeAccountSessionEngine } from "@/engine/stripeConnect"
import { assertMerchantBusinessProfileComplete } from "@/engine/businessProfile"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

/**
 * Creates an embedded-onboarding Account Session for the authenticated
 * merchant's connected account (creating the account first when needed).
 * Returns only the short-lived Account Session client secret — it is never
 * persisted or logged, and no Stripe account identifiers are exposed.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    await assertMerchantBusinessProfileComplete(merchantId)
    const result = await createStripeAccountSessionEngine({ merchantId })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 503 })
    }

    return NextResponse.json({ ok: true, clientSecret: result.clientSecret })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
