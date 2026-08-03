/**
 * POST /api/internal/shift4/connect - Shift4 Access Token Exchange entry point.
 *
 * Layering: authenticated route -> Shift4 Engine -> provider adapter ->
 * encrypted database storage. This module performs no HTTP call to Shift4 and
 * touches no database directly.
 *
 * ── Auth token discipline ────────────────────────────────────────────────────
 * The merchant's Auth Token is issued by their Lighthouse Transaction Manager
 * Account Administrator and is a RUNTIME-ONLY input. It arrives here once, is
 * handed to the Engine, and is never persisted, logged, echoed, or placed in an
 * environment variable. Production auth tokens are single-use.
 *
 * ── Response discipline ──────────────────────────────────────────────────────
 * The response carries only non-secret evidence that the exchange happened. The
 * Auth Token, the Client GUID, the Access Token, the encrypted envelope, and
 * the raw provider body are never serialized.
 */

import { NextRequest, NextResponse } from "next/server"

import { getShift4RetailConnectSurface, isValidIanaTimeZone } from "@/engine/shift4/connectSurface"
import { connectShift4Merchant, Shift4ConnectionError } from "@/engine/shift4Connection"
import { requireShift4OperatorFromRequest } from "@/lib/api/shift4OperatorAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The exchange body is three short fields. Anything larger is rejected before
 * it is parsed, so an oversized payload cannot be buffered or walked.
 */
const MAX_BODY_BYTES = 4_096

/** Shift4's documented maximum Auth Token length is 51 characters. */
const MAX_AUTH_TOKEN_LENGTH = 51

const ALLOWED_FIELDS = new Set(["authToken", "channel", "merchantTimeZone"])

function badRequest(message: string, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status: 400, code })
}

/**
 * Read and validate the body.
 *
 * Rejects: a non-JSON content type, an oversized body, unsupported fields, a
 * body-supplied merchant identifier, a blank or overlong auth token, a missing
 * or `shared` channel, and an invalid time zone.
 */
async function readConnectRequest(request: NextRequest): Promise<{
  authToken: string
  channel: "retail" | "ecommerce"
  merchantTimeZone: string
}> {
  const contentType = String(request.headers.get("content-type") || "")
  if (!contentType.toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json"), {
      status: 415,
      code: "unsupported_media_type",
    })
  }

  const declaredLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), {
      status: 413,
      code: "payload_too_large",
    })
  }

  const raw = await request.text()
  // Checked again after reading: Content-Length is client-supplied and a
  // chunked request may not send it at all.
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
    throw badRequest("A JSON object body is required", "invalid_json")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("A JSON object body is required", "invalid_json")
  }

  const body = parsed as Record<string, unknown>

  // Merchant identity comes from the verified bearer token only. Naming it in
  // the body is rejected outright rather than ignored, so a caller can never
  // believe it selected another merchant.
  for (const forbidden of ["merchantId", "merchant_id"]) {
    if (forbidden in body) {
      throw Object.assign(
        new Error("merchantId cannot be supplied in the request body"),
        { status: 403, code: "merchant_id_not_accepted" }
      )
    }
  }

  const unsupported = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key))
  if (unsupported.length > 0) {
    throw badRequest(`Unsupported field: ${unsupported.sort().join(", ")}`, "unsupported_field")
  }

  const authToken = typeof body.authToken === "string" ? body.authToken.trim() : ""
  if (!authToken) {
    throw badRequest("authToken is required", "invalid_request")
  }
  if (authToken.length > MAX_AUTH_TOKEN_LENGTH) {
    // The length is a documented Shift4 limit; the value itself is never echoed.
    throw badRequest("authToken exceeds the maximum supported length", "invalid_request")
  }

  const channel = body.channel
  if (channel !== "retail" && channel !== "ecommerce") {
    throw badRequest(
      "channel must be \"retail\" or \"ecommerce\". A shared connection is not supported.",
      "invalid_channel"
    )
  }

  const merchantTimeZone = typeof body.merchantTimeZone === "string" ? body.merchantTimeZone.trim() : ""
  if (!merchantTimeZone) {
    throw badRequest("merchantTimeZone is required", "invalid_request")
  }
  if (!isValidIanaTimeZone(merchantTimeZone)) {
    throw badRequest("merchantTimeZone must be a valid IANA time zone", "invalid_time_zone")
  }

  return { authToken, channel, merchantTimeZone }
}

/** A stored credential must never be cached by a browser or a shared proxy. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  response.headers.set("Pragma", "no-cache")
  return response
}

/**
 * Describe the connect surface for the authenticated merchant.
 *
 * Deliberately lives on the SAME route as the exchange rather than a second
 * connection endpoint. Read-only: it performs no exchange and enables nothing.
 * The response carries one environment-derived boolean plus a coarse reason
 * code, the merchant's configured time zone, and non-secret channel status.
 */
export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireShift4OperatorFromRequest(request)
    return noStore(shift4Success(await getShift4RetailConnectSurface(merchantId)))
  } catch (error) {
    return noStore(shift4Error(error, "Unable to load the Shift4 connect surface"))
  }
}

export async function POST(request: NextRequest) {
  try {
    // Operator authorization first: an unauthorized caller must not be able to
    // probe body validation, and must never reach the exchange.
    const merchantId = await requireShift4OperatorFromRequest(request)
    const { authToken, channel, merchantTimeZone } = await readConnectRequest(request)

    const result = await connectShift4Merchant({
      merchantId,
      authToken,
      channel,
      merchantTimeZone,
    })

    // Explicitly constructed rather than spread, so a future Engine field can
    // never widen this response into carrying a secret.
    return noStore(
      shift4Success({
        connectionId: result.connectionId,
        environment: result.environment,
        channel: result.channel,
        accessTokenFingerprint: result.accessTokenFingerprint,
        connectedAt: result.connectedAt,
        correlationId: result.correlationId,
      })
    )
  } catch (error) {
    return noStore(shift4Error(mapConnectionError(error), "Shift4 connection failed"))
  }
}

/**
 * Give the Engine's connection errors an HTTP status.
 *
 * `Shift4ConnectionError` messages are written for an authenticated operator
 * and carry no credential material; `providerShortText` is a documented
 * non-secret Shift4 field. Anything else falls through to the standard envelope,
 * which replaces unexpected server messages with a generic fallback.
 */
function mapConnectionError(error: unknown): unknown {
  if (!(error instanceof Shift4ConnectionError)) return error

  const status =
    error.code === "exchange_in_progress" ? 409
    : error.code === "auth_token_already_used" ? 409
    : error.code === "invalid_channel" ? 400
    : error.code === "not_configured" ? 503
    : 502

  return Object.assign(new Error(error.message), { status, code: error.code })
}
