/**
 * POST /api/internal/shift4/retail-verification — verify the stored Shift4
 * Retail credential.
 *
 * Layering: Admin operator interface -> THIS route -> Shift4 Engine ->
 * Shift4 REST adapter -> Shift4 test API. The route performs no HTTP call to
 * Shift4, reads no database table, and decrypts nothing.
 *
 * ── Server-derived inputs ────────────────────────────────────────────────────
 * The browser supplies NOTHING. Merchant identity comes from the verified
 * operator session, the channel is fixed to Retail by the Engine, and the
 * environment comes from server configuration. A request body naming a
 * merchant, email, channel, environment, Client GUID or Access Token is
 * rejected outright rather than ignored, so a caller can never believe it
 * selected any of them.
 *
 * ── Read-only ────────────────────────────────────────────────────────────────
 * POST is the method because this is an explicit, non-cacheable operator
 * action, not because anything is written. The Engine performs one documented
 * read-only lookup; no Access Token Exchange, no transaction, and no feature
 * flag change is reachable from this route.
 *
 * ── Response discipline ──────────────────────────────────────────────────────
 * The success body is rebuilt field by field from the Engine result. The Access
 * Token, Auth Token, Client GUID, encrypted envelope, raw provider response,
 * request/response headers and database row are never serialized.
 */

import { NextRequest, NextResponse } from "next/server"

import { Shift4RetailVerificationError, verifyShift4RetailConnection } from "@/engine/shift4/verifyRetailConnection"
import { requireShift4OperatorFromRequest } from "@/lib/api/shift4OperatorAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** The verification takes no input, so any body at all is a caller mistake. */
const MAX_BODY_BYTES = 512

/**
 * Reject a request that tries to supply input.
 *
 * An empty body and `{}` are the only accepted shapes. Naming a field is a hard
 * failure — silently ignoring `channel` or `merchantId` would let an operator
 * believe they had chosen something.
 */
async function assertNoCallerInput(request: NextRequest): Promise<void> {
  const declaredLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), {
      status: 413,
      code: "payload_too_large",
    })
  }

  const raw = (await request.text()).trim()
  if (!raw) return

  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), {
      status: 413,
      code: "payload_too_large",
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw Object.assign(new Error("This verification accepts no request body"), {
      status: 400,
      code: "body_not_accepted",
    })
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("This verification accepts no request body"), {
      status: 400,
      code: "body_not_accepted",
    })
  }

  if (Object.keys(parsed as Record<string, unknown>).length > 0) {
    throw Object.assign(
      new Error(
        "This verification accepts no request body. Merchant, channel and environment are all server-derived."
      ),
      { status: 403, code: "caller_input_not_accepted" }
    )
  }
}

/** Verification evidence must never be cached by a browser or a shared proxy. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  response.headers.set("Pragma", "no-cache")
  return response
}

export async function POST(request: NextRequest) {
  try {
    // Operator authorization first: an unauthorized caller must not be able to
    // probe body validation and must never reach the provider.
    const merchantId = await requireShift4OperatorFromRequest(request)
    await assertNoCallerInput(request)

    const verification = await verifyShift4RetailConnection(merchantId)

    // Explicitly constructed rather than spread, so a future Engine field can
    // never widen this response into carrying a secret.
    return noStore(
      shift4Success({
        connectionId: verification.connectionId,
        environment: verification.environment,
        channel: verification.channel,
        credentialSource: verification.credentialSource,
        operation: verification.operation,
        serverName: verification.serverName,
        providerDateTime: verification.providerDateTime,
        verifiedAt: verification.verifiedAt,
        correlationId: verification.correlationId,
        proves: verification.proves,
        doesNotProve: verification.doesNotProve,
        capabilities: {
          restApiEnabled: verification.capabilities.restApiEnabled,
          retailProcessingEnabled: verification.capabilities.retailProcessingEnabled,
        },
      })
    )
  } catch (error) {
    return noStore(shift4Error(mapVerificationError(error), "Shift4 Retail verification failed"))
  }
}

/**
 * Give the Engine's verification errors an HTTP status.
 *
 * `Shift4RetailVerificationError` messages are written for an authenticated
 * operator and carry no credential material, no provider body and no
 * configuration detail. Anything else falls through to the standard envelope,
 * which replaces unexpected server messages with a generic fallback.
 */
function mapVerificationError(error: unknown): unknown {
  if (!(error instanceof Shift4RetailVerificationError)) return error

  const status =
    error.code === "rest_disabled" ? 503
    : error.code === "not_configured" ? 503
    : error.code === "connection_unavailable" ? 409
    : error.code === "environment_mismatch" ? 409
    : 502

  return Object.assign(new Error(error.message), { status, code: error.code })
}
