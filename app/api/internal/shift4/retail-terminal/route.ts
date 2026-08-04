/**
 * /api/internal/shift4/retail-terminal — Shift4 Retail terminal configuration.
 *
 *   GET   read the merchant's current Shift4 terminal configuration
 *   POST  create or replace it, on an explicit operator intent
 *
 * Layering: Admin operator interface -> THIS route -> Shift4 Engine ->
 * existing terminal database services. The route reads no table itself,
 * contacts no provider, and decrypts nothing.
 *
 * ── Server-derived identity ──────────────────────────────────────────────────
 * Merchant identity comes from the verified operator session. Provider,
 * environment and channel are decided by the Engine and have no parameter here.
 * A body naming any of them — or an email, Client GUID, or Access Token — is
 * REJECTED rather than ignored, so a caller can never believe it selected one.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * Operator authorization runs before the body is read. An unauthorized caller
 * cannot probe validation behavior and never reaches the Engine.
 *
 * ── Response discipline ──────────────────────────────────────────────────────
 * Success bodies are built field by field from the Engine view. No database row
 * is spread, no full serial number is returned, and no credential, token,
 * provider payload, header, or SQL detail is reachable from this route.
 */

import { NextRequest, NextResponse } from "next/server"

import {
  configureShift4RetailTerminal,
  getShift4RetailTerminal,
  listShift4RetailTerminalSelections,
  normalizeShift4TerminalInput,
  Shift4RetailTerminalError,
  type Shift4RetailTerminalView,
} from "@/engine/shift4/retailTerminal"
import { requireShift4OperatorFromRequest } from "@/lib/api/shift4OperatorAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Comfortably larger than the five permitted fields, far too small to abuse. */
const MAX_BODY_BYTES = 4096

/**
 * Field names that must never be accepted, even to be ignored.
 *
 * `normalizeShift4TerminalInput` already rejects every unsupported key, so this
 * list is a second, explicit statement about the ones that matter: each names
 * something the server alone decides, or a secret the browser must never hold.
 */
const FORBIDDEN_BODY_FIELDS = [
  "merchantId",
  "merchant_id",
  "provider",
  "environment",
  "channel",
  "email",
  "operatorEmail",
  "clientGuid",
  "authToken",
  "accessToken",
  "simulated",
  "status",
] as const

/** Terminal configuration must never be cached by a browser or shared proxy. */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  response.headers.set("Pragma", "no-cache")
  return response
}

/** Build the wire body explicitly. Never spread the Engine view or a row. */
function terminalBody(view: Shift4RetailTerminalView) {
  return {
    readerId: view.readerId,
    terminalId: view.terminalId,
    model: view.model,
    maskedSerial: view.maskedSerial,
    locationId: view.locationId,
    integrationMethod: view.integrationMethod,
    environment: view.environment,
    channel: view.channel,
    configured: view.configured,
    connectivityState: view.connectivityState,
    evidenceSource: view.evidenceSource,
    lastVerifiedAt: view.lastVerifiedAt,
    correlationId: view.correlationId,
    readinessState: view.readinessState,
    retailProcessingEnabled: view.retailProcessingEnabled,
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), {
      status: 413,
      code: "payload_too_large",
    })
  }

  const raw = (await request.text()).trim()
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), {
      status: 413,
      code: "payload_too_large",
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw || "null") as unknown
  } catch {
    throw Object.assign(new Error("A JSON object body is required"), {
      status: 400,
      code: "invalid_json",
    })
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("A JSON object body is required"), {
      status: 400,
      code: "invalid_json",
    })
  }

  const body = parsed as Record<string, unknown>
  const forbidden = FORBIDDEN_BODY_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  )
  if (forbidden.length > 0) {
    throw Object.assign(
      new Error(
        `Merchant, provider, environment and channel are server-derived and cannot be supplied: ${forbidden.join(", ")}`
      ),
      { status: 403, code: "caller_input_not_accepted" }
    )
  }

  return body
}

export async function GET(request: NextRequest) {
  try {
    const merchantId = await requireShift4OperatorFromRequest(request)
    const [view, selections] = await Promise.all([
      getShift4RetailTerminal(merchantId),
      listShift4RetailTerminalSelections(merchantId),
    ])

    // The list exists so an operator with several terminals can name which one
    // to verify. Each entry is rebuilt from the same explicit safe field set —
    // no serial number, credential, or provider payload travels with it.
    return noStore(
      shift4Success({
        ...terminalBody(view),
        readers: selections.map((reader) => ({
          readerId: reader.readerId,
          label: reader.label,
          terminalId: reader.terminalId,
          model: reader.model,
          maskedSerial: reader.maskedSerial,
          locationId: reader.locationId,
          isDefault: reader.isDefault,
          connectivityState: reader.connectivityState,
          readinessState: reader.readinessState,
          lastVerifiedAt: reader.lastVerifiedAt,
        })),
      })
    )
  } catch (error) {
    return noStore(shift4Error(mapTerminalError(error), "Shift4 terminal lookup failed"))
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authorization strictly before any body handling.
    const merchantId = await requireShift4OperatorFromRequest(request)
    const input = normalizeShift4TerminalInput(await readBody(request))

    return noStore(
      shift4Success(terminalBody(await configureShift4RetailTerminal(merchantId, input)))
    )
  } catch (error) {
    return noStore(shift4Error(mapTerminalError(error), "Shift4 terminal configuration failed"))
  }
}

/**
 * Give the Engine's terminal errors an HTTP status.
 *
 * `Shift4RetailTerminalError` messages are written for an authenticated operator
 * and carry no credential material, provider body, or database detail. Anything
 * else falls through to the standard envelope, which replaces unexpected server
 * messages with a generic fallback plus a fresh correlation ID.
 */
function mapTerminalError(error: unknown): unknown {
  if (!(error instanceof Shift4RetailTerminalError)) return error

  const status =
    error.code === "rest_disabled" ? 503
    : error.code === "not_configured" ? 503
    : error.code === "configuration_unavailable" ? 503
    : error.code === "invalid_input" ? 400
    : error.code === "location_not_found" ? 400
    : 409

  return Object.assign(new Error(error.message), { status, code: error.code })
}
