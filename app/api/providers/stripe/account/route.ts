import { NextRequest, NextResponse } from "next/server"
import { ensureStripeConnectedAccountEngine } from "@/engine/stripeConnect"
import { assertMerchantBusinessProfileComplete } from "@/engine/businessProfile"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

/**
 * Ensures the authenticated merchant has a Stripe connected account.
 * Creates one only when none exists; always returns the safe normalized
 * connection state. Merchant identity comes from the session — never from
 * the request body.
 */
export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    await assertMerchantBusinessProfileComplete(merchantId)
    const result = await ensureStripeConnectedAccountEngine({ merchantId })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 503 })
    }

    return NextResponse.json({ ok: true, created: result.created, connection: result.connection })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
