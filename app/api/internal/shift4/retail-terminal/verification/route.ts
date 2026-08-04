/**
 * POST /api/internal/shift4/retail-terminal/verification — verify Shift4
 * terminal readiness.
 *
 * Layering: Admin operator interface -> THIS route -> Shift4 Engine -> existing
 * terminal database services.
 *
 * ── Read-only in both directions ─────────────────────────────────────────────
 * The Engine writes nothing and SENDS nothing. No documented Shift4 or Commerce
 * Engine terminal-status operation exists in this repository's sources, so no
 * provider request is made and none is invented; the response says so with
 * `providerCallPerformed: false` and an `evidenceSource` naming PineTree's own
 * configuration as the source.
 *
 * No authorization, sale, capture, refund, void, tokenization, Access Token
 * Exchange, or cardholder data is reachable from this route.
 *
 * ── No caller input ──────────────────────────────────────────────────────────
 * The request carries no body. Merchant identity comes from the verified
 * operator session; provider, channel and environment are Engine constants and
 * server configuration. Any non-empty body is rejected.
 */

import { NextRequest, NextResponse } from "next/server"

import {
  Shift4RetailTerminalError,
  verifyShift4RetailTerminalReadiness,
} from "@/engine/shift4/retailTerminal"
import { requireShift4OperatorFromRequest } from "@/lib/api/shift4OperatorAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** The check takes no input, so any body at all is a caller mistake. */
const MAX_BODY_BYTES = 512

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
    throw Object.assign(new Error("This check accepts no request body"), {
      status: 400,
      code: "body_not_accepted",
    })
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("This check accepts no request body"), {
      status: 400,
      code: "body_not_accepted",
    })
  }

  if (Object.keys(parsed as Record<string, unknown>).length > 0) {
    throw Object.assign(
      new Error(
        "This check accepts no request body. Merchant, channel and environment are all server-derived."
      ),
      { status: 403, code: "caller_input_not_accepted" }
    )
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  response.headers.set("Pragma", "no-cache")
  return response
}

export async function POST(request: NextRequest) {
  try {
    // Operator authorization precedes body inspection.
    const merchantId = await requireShift4OperatorFromRequest(request)
    await assertNoCallerInput(request)

    const verification = await verifyShift4RetailTerminalReadiness(merchantId)

    // Explicitly constructed, never spread: a future Engine field cannot widen
    // this response into carrying a serial number or a secret.
    return noStore(
      shift4Success({
        readerId: verification.readerId,
        terminalId: verification.terminalId,
        model: verification.model,
        maskedSerial: verification.maskedSerial,
        locationId: verification.locationId,
        integrationMethod: verification.integrationMethod,
        environment: verification.environment,
        channel: verification.channel,
        configured: verification.configured,
        connectivityState: verification.connectivityState,
        evidenceSource: verification.evidenceSource,
        lastVerifiedAt: verification.lastVerifiedAt,
        correlationId: verification.correlationId,
        readinessState: verification.readinessState,
        retailProcessingEnabled: verification.retailProcessingEnabled,
        providerCallPerformed: verification.providerCallPerformed,
        awaiting: verification.awaiting,
        proves: verification.proves,
        doesNotProve: verification.doesNotProve,
      })
    )
  } catch (error) {
    return noStore(shift4Error(mapTerminalError(error), "Shift4 terminal verification failed"))
  }
}

function mapTerminalError(error: unknown): unknown {
  if (!(error instanceof Shift4RetailTerminalError)) return error

  const status =
    error.code === "rest_disabled" ? 503
    : error.code === "not_configured" ? 503
    : error.code === "configuration_unavailable" ? 503
    : error.code === "invalid_input" ? 400
    : 409

  return Object.assign(new Error(error.message), { status, code: error.code })
}
