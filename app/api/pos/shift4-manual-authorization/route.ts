import { NextRequest, NextResponse } from "next/server"

import {
  normalizeShift4AuthorizationCode,
  SHIFT4_MANUAL_AUTHORIZATION_FORBIDDEN_FIELDS,
  Shift4ManualAuthorizationError,
} from "@/engine/shift4/manualAuthorization"
import { readShift4FeatureFlags } from "@/engine/shift4/readiness"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

/**
 * POST /api/pos/shift4-manual-authorization — submit a voice approval code.
 *
 * After a referral (`transaction.responseCode` of `R`) the clerk telephones the
 * issuer's voice centre and receives a six-character code. This route accepts
 * that code and a PineTree payment reference — nothing else.
 *
 * Merchant identity comes from the signed terminal session. The invoice, the
 * amount, the provider connection, the card token, the device serial and the
 * Level 2 purchasing-card data are ALL derived server-side from the persisted
 * referral attempt. That is the point: a caller who could choose the invoice or
 * the amount could attach a genuine phone approval to a different transaction.
 *
 * Dispatch remains blocked by the Retail and certification gates. With them off
 * this route validates and reports, and sends nothing to Shift4.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The ONLY two keys a caller may send. */
const ALLOWED_BODY_KEYS = new Set(["paymentId", "authorizationCode"])

const noStore = { "Cache-Control": "no-store" } as const

export async function POST(request: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(request)

    const parsed = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400, headers: noStore }
      )
    }

    // Allow-list, then an explicit check against the fields that would let a
    // caller redirect a phone approval onto another transaction.
    const extra = Object.keys(parsed).filter((key) => !ALLOWED_BODY_KEYS.has(key))
    if (extra.length > 0) {
      const forbidden = extra.filter((key) =>
        SHIFT4_MANUAL_AUTHORIZATION_FORBIDDEN_FIELDS.includes(key)
      )
      return NextResponse.json(
        {
          error: forbidden.length > 0
            ? "Merchant, invoice, amount, token, terminal and purchasing-card data are all server-derived and cannot be supplied."
            : "Only paymentId and authorizationCode are accepted.",
        },
        { status: 403, headers: noStore }
      )
    }

    const paymentId = typeof parsed.paymentId === "string" ? parsed.paymentId.trim() : ""
    if (!UUID_PATTERN.test(paymentId)) {
      return NextResponse.json(
        { error: "A PineTree payment reference is required" },
        { status: 400, headers: noStore }
      )
    }

    // Validated and uppercased. The rejected value is never echoed back, and the
    // accepted value is never logged here.
    const authorizationCode = normalizeShift4AuthorizationCode(parsed.authorizationCode)

    const flags = readShift4FeatureFlags()
    const blockedReason = !flags.restApi
      ? "Shift4 REST is disabled for this deployment"
      : !flags.retail
        ? "Awaiting Retail test enablement"
        : !flags.certificationMode
          ? "Awaiting Shift4 certification mode"
          : "Awaiting physical terminal verification"

    // Every gate that would permit a real dispatch is closed. The code was
    // accepted and validated; it is not sent, and no attempt is created.
    return NextResponse.json(
      {
        dispatchPermitted: false,
        blockedReason,
        providerCallPerformed: false,
        paymentId,
        // Proof the code passed validation, without echoing the code itself.
        authorizationCodeAccepted: authorizationCode.length === 6,
        merchantScoped: Boolean(merchantId),
      },
      { headers: noStore }
    )
  } catch (error) {
    if (error instanceof Shift4ManualAuthorizationError) {
      const status = error.code === "invalid_authorization_code" ? 400 : 409
      return NextResponse.json({ error: error.message }, { status, headers: noStore })
    }
    return NextResponse.json(
      { error: "Unable to submit the manual authorization" },
      { status: getRouteErrorStatus(error), headers: noStore }
    )
  }
}
