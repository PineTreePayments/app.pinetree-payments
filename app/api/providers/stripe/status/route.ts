import { NextRequest, NextResponse } from "next/server"
import { syncStripeConnectionEngine } from "@/engine/stripeConnect"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

/**
 * Retrieves the authenticated merchant's current Stripe account state,
 * normalizes it, synchronizes PineTree's database (the source of truth for
 * provider connection status), and returns the safe normalized state.
 * Never returns raw Stripe account objects or account identifiers.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await syncStripeConnectionEngine({ merchantId })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
    }

    return NextResponse.json({ ok: true, connection: result.connection })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
