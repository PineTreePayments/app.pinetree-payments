import { NextRequest, NextResponse } from "next/server"

import {
  listShift4PaymentAttempts,
  type Shift4AttemptRole,
  type Shift4AttemptState,
} from "@/database/shift4PaymentAttempts"
import { SHIFT4_REFERRAL_RESPONSE_CODE } from "@/engine/shift4/manualAuthorization"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

/**
 * GET /api/pos/shift4-referral-status?paymentId=… — does this payment need a
 * voice authorization from the clerk right now?
 *
 * This is NOT a second payment-status system. The existing payment-status poll
 * still owns whether the sale is processing, confirmed or failed. This endpoint
 * answers a different question the POS cannot otherwise ask: the sale is sitting
 * in PROCESSING — is that because Shift4 returned a referral and a human has to
 * telephone the issuer?
 *
 * The referral test is the SAME one the Engine enforces in
 * `assertShift4ReferralLineage`: a `transaction.responseCode` of `R`, or a
 * persisted `attempt_role` of `referral_authorization`. Nothing is inferred from
 * a generic failure, a decline, a timeout, or anything the browser supplied.
 *
 * Merchant identity comes from the signed terminal session, and attempts are
 * read merchant-scoped, so another merchant's payment is indistinguishable from
 * one that does not exist.
 *
 * The response is built field by field and carries only a boolean. No invoice,
 * amount, token, connection id, device serial, response code, attempt id or raw
 * provider evidence can reach the browser through it.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const noStore = { "Cache-Control": "no-store" } as const

/** States in which a referral attempt is finished and needs no clerk action. */
const SETTLED_ATTEMPT_STATES = new Set<Shift4AttemptState>([
  "approved",
  "declined",
  "abandoned",
])

/**
 * Roles whose approval means this payment has already moved past the referral —
 * the phone approval was submitted, or the sale was captured or voided.
 */
const RESOLVING_ROLES = new Set<Shift4AttemptRole>([
  "manual_authorization",
  "capture",
  "void",
])

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

    // Retail only. A Shift4 E-commerce referral is not a clerk's job, and no
    // other provider's attempts live in this table at all.
    const hasOpenReferral = attempts.some(
      (row) =>
        row.channel === "retail" &&
        (row.attempt_role === "referral_authorization" ||
          row.response_code === SHIFT4_REFERRAL_RESPONSE_CODE) &&
        !SETTLED_ATTEMPT_STATES.has(row.state)
    )

    const alreadyResolved = attempts.some(
      (row) => RESOLVING_ROLES.has(row.attempt_role) && row.state === "approved"
    )

    return NextResponse.json(
      { paymentId, referralRequired: hasOpenReferral && !alreadyResolved },
      { headers: noStore }
    )
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to check the Shift4 referral status" },
      { status: getRouteErrorStatus(error), headers: noStore }
    )
  }
}
