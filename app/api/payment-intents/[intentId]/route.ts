import { NextRequest, NextResponse } from "next/server"
import { getPaymentIntentEngine } from "@/engine/paymentIntents"
import { signCheckoutSession } from "@/lib/api/checkoutAuth"
import { makeRateLimiter, getRequestIp } from "@/lib/api/rateLimit"

// 60 lookups per IP per minute.  Protects against enumeration and token
// harvesting without affecting legitimate checkout page loads.
const intentLimiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 60 })

type Params = { params: Promise<{ intentId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const ip = getRequestIp(req)
  const limit = intentLimiter.check(ip)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } }
    )
  }

  try {
    const { intentId } = await params
    const id = String(intentId || "").trim()
    const intent = await getPaymentIntentEngine(id)

    if (!intent) {
      return NextResponse.json({ error: "Payment intent not found" }, { status: 404 })
    }

    // Issue a short-lived checkout session token scoped to this intent.
    // The customer uses it to authorise safe cancellation actions (e.g. /fail)
    // without holding merchant credentials.
    const checkoutToken = signCheckoutSession(id)

    return NextResponse.json({ ...intent, checkoutToken })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch payment intent" },
      { status: 500 }
    )
  }
}
