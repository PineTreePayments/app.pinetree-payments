import { NextRequest, NextResponse } from "next/server"

import { listShift4PaymentAttempts } from "@/database/shift4PaymentAttempts"
import { classifyShift4ReferralState } from "@/engine/shift4/referralState"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

/**
 * GET /api/pos/shift4-referral-status?paymentId=… — does this payment need a
 * voice authorization from the clerk right now?
 *
 * A thin authenticated adapter. It authenticates, reads merchant-scoped
 * attempts, and hands them to `classifyShift4ReferralState`; every lifecycle
 * rule about what a referral is and what resolves one lives in the Engine.
 *
 * This is NOT a second payment-status system. The existing payment-status poll
 * still owns whether the sale is processing, confirmed or failed. This answers
 * a question that poll cannot: the sale is sitting in PROCESSING — is that
 * because Shift4 returned a referral and a human has to telephone the issuer?
 *
 * `shift4Retail` exists so the POS can stop asking. The terminal cannot know
 * which provider owns the active sale without asking the server, and without
 * this the check would repeat for every Stripe card sale forever. It is the
 * clerk's own payment, and it is the minimum classification that lets the
 * client stop.
 *
 * Merchant identity comes from the signed terminal session and attempts are
 * read merchant-scoped, so another merchant's payment is indistinguishable from
 * one that does not exist. The response is built field by field and carries two
 * booleans: no invoice, amount, token, connection id, device serial, response
 * code, attempt id or raw provider evidence can reach the browser through it.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const noStore = { "Cache-Control": "no-store" } as const

export async function GET(request: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(request)

    const paymentId = request.nextUrl.searchParams.get("paymentId")?.trim() ?? ""
    if (!UUID_PATTERN.test(paymentId)) {
      return NextResponse.json(
        { error: "A PineTree payment reference is required" },
        { status: 400, headers: noStore }
      )
    }

    const attempts = await listShift4PaymentAttempts(merchantId, paymentId)
    const classification = classifyShift4ReferralState(attempts)

    return NextResponse.json(
      {
        paymentId,
        shift4Retail: classification.shift4Retail,
        referralRequired: classification.referralRequired,
      },
      { headers: noStore }
    )
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to check the Shift4 referral status" },
      { status: getRouteErrorStatus(error), headers: noStore }
    )
  }
}
