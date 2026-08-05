/**
 * Bridge (by Stripe) - shared API route helpers.
 *
 * Every Bridge route is a thin wrapper: authenticate, call PineTree Engine,
 * shape the response. No route contains business logic, and no route ever
 * returns a raw Bridge payload, a Bridge identifier, or a provider error
 * message.
 */

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

import { getRouteErrorStatus, requireMerchantAuthFromRequest } from "./merchantAuth"

export type BridgeRouteEnvelope<T> = {
  ok: true
  data: T
  correlationId: string
}

export function bridgeSuccess<T>(data: T, correlationId?: string, status = 200) {
  return NextResponse.json(
    { ok: true, data, correlationId: correlationId || randomUUID() },
    { status }
  )
}

export function bridgeFailure(input: {
  message: string
  code?: string
  status?: number
  correlationId?: string
}) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: input.code || "bridge_request_failed",
        message: input.message,
        correlationId: input.correlationId || randomUUID(),
      },
    },
    { status: input.status ?? 400 }
  )
}

/**
 * Convert an unexpected throw into a safe response.
 *
 * A 5xx never echoes the underlying message: an internal error could carry a
 * database detail or a provider fragment, and neither belongs in a merchant
 * response.
 */
export function bridgeRouteError(error: unknown, fallback = "Bridge request failed") {
  const status = getRouteErrorStatus(error)
  const message = status >= 500 ? fallback : error instanceof Error ? error.message : fallback
  return bridgeFailure({
    message,
    code: status >= 500 ? "internal_error" : "request_failed",
    status,
  })
}

/**
 * Resolve the merchant for a Bridge provider-management request.
 *
 * Provider onboarding and enablement are account-owner actions performed from
 * the authenticated dashboard, so a merchant API key is deliberately rejected:
 * a programmatic integration key must not be able to start KYB or turn a
 * settlement provider on. The merchant id always comes from the verified
 * session - a client-supplied merchant_id is never trusted.
 */
export async function requireBridgeMerchantSession(
  req: NextRequest
): Promise<{ merchantId: string; actorId: string }> {
  const auth = await requireMerchantAuthFromRequest(req)

  if (auth.source !== "supabase") {
    throw Object.assign(
      new Error("Bridge provider management requires a signed-in merchant account."),
      { status: 403 }
    )
  }

  return { merchantId: auth.merchantId, actorId: auth.authUserId }
}

/** Read a JSON object body, tolerating an empty body as `{}`. */
export async function readOptionalJsonObject(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}
