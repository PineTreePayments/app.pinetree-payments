import { NextRequest, NextResponse } from "next/server"
import { syncStripeConnectAccount } from "@/engine/stripeConnect"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await syncStripeConnectAccount({ merchantId })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal error" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
