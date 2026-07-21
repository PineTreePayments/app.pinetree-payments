import { type NextRequest, NextResponse } from "next/server"
import { confirmMerchantWithdrawalDestination } from "@/engine/withdrawals/withdrawalDestinations"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { makeRateLimiter, getRequestIp } from "@/lib/api/rateLimit"

const confirmRateLimiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 20 })

/**
 * The merchant confirms they verified this destination supports the exact
 * asset/network before it can back an automatic sweep rule. This is an
 * application-level acknowledgment, not a cryptographic ownership proof -
 * callers must never render this as "Verified."
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    if (!confirmRateLimiter.check(`${merchantId}:${getRequestIp(req)}`).allowed) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }
    const { id } = await params
    const destination = await confirmMerchantWithdrawalDestination(merchantId, id)
    return NextResponse.json({ destination })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm destination"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
