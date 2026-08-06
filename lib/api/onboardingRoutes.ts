/**
 * PineTree onboarding / business-verification - shared API route helpers.
 *
 * Every onboarding route is a thin wrapper: authenticate, call PineTree
 * Engine, shape the response. No route contains business logic, and no route
 * returns a provider payload, a provider identifier, or a provider error
 * message.
 *
 * These routes are PineTree-domain by design. Merchants never call a
 * provider-named endpoint, because merchants are never asked to connect a
 * provider.
 */

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

import { getRouteErrorStatus, requireMerchantAuthFromRequest } from "./merchantAuth"

export function onboardingSuccess<T>(data: T, correlationId?: string, status = 200) {
  return NextResponse.json(
    { ok: true, data, correlationId: correlationId || randomUUID() },
    { status }
  )
}

export function onboardingFailure(input: {
  message: string
  code?: string
  status?: number
  correlationId?: string
}) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: input.code || "request_failed",
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
export function onboardingRouteError(error: unknown, fallback = "Request failed") {
  const status = getRouteErrorStatus(error)
  const message = status >= 500 ? fallback : error instanceof Error ? error.message : fallback
  return onboardingFailure({
    message,
    code: status >= 500 ? "internal_error" : "request_failed",
    status,
  })
}

/**
 * Resolve the merchant for a business-verification request.
 *
 * Verification and consent are account-owner actions performed from the
 * authenticated dashboard, so a merchant API key is deliberately rejected: no
 * approved API-key scope exists for accepting legal terms on a business's
 * behalf or for advancing regulated verification. The merchant id always comes
 * from the verified session - a client-supplied merchant id is never trusted.
 */
export async function requireOnboardingMerchantSession(
  req: NextRequest
): Promise<{ merchantId: string; actorId: string }> {
  const auth = await requireMerchantAuthFromRequest(req)

  if (auth.source !== "supabase") {
    throw Object.assign(
      new Error("Business verification requires a signed-in merchant account."),
      { status: 403 }
    )
  }

  return { merchantId: auth.merchantId, actorId: auth.authUserId }
}

/**
 * Audit metadata for a consent action.
 *
 * Only what is needed to prove a deliberate acceptance: the forwarded client
 * IP and a bounded user-agent string. Nothing here is used for tracking.
 */
export function consentRequestMetadata(req: NextRequest): {
  sourceIp: string | null
  userAgent: string | null
} {
  const forwarded = req.headers.get("x-forwarded-for") || ""
  const sourceIp = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null
  const userAgent = req.headers.get("user-agent")

  return {
    // An unparseable value is dropped rather than stored: the column is inet.
    sourceIp: sourceIp && /^[0-9a-fA-F.:]+$/.test(sourceIp) ? sourceIp : null,
    userAgent: userAgent ? userAgent.slice(0, 400) : null,
  }
}

export async function readOptionalJsonObject(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}
