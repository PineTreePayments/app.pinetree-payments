/**
 * POST /api/internal/shift4/retail-terminal/verification — verify Shift4
 * terminal readiness.
 *
 * Layering: Admin operator interface -> THIS route -> Shift4 Engine -> existing
 * terminal database services.
 *
 * ── What this now does ───────────────────────────────────────────────────────
 * Shift4 documents `POST /devices/getstatus` for Commerce Engine For Cloud, so
 * this route can finally ask a real question. With a configured, addressable
 * reader it performs EXACTLY ONE provider request and reports the three
 * documented flags. With nothing configured it sends nothing and says so.
 *
 * No authorization, sale, capture, refund, void, tokenization, Access Token
 * Exchange, or cardholder data is reachable from this route.
 *
 * ── The only caller input ────────────────────────────────────────────────────
 * A single optional `readerId`, and only one PineTree already listed for this
 * merchant. Merchant identity comes from the verified operator session;
 * provider, channel, environment, terminal ID, serial number and manufacturer
 * are all server-derived. A raw Shift4 terminal ID is not accepted, and any
 * other body key is rejected outright.
 *
 * When the merchant owns more than one reader, `readerId` is REQUIRED: checking
 * an unnamed `readers[0]` would report one device's health under another's name.
 */

import { NextRequest, NextResponse } from "next/server"

import {
  Shift4DeviceStatusError,
  verifyShift4RetailDeviceStatus,
} from "@/engine/shift4/deviceStatus"
import {
  Shift4RetailTerminalError,
  verifyShift4RetailTerminalReadiness,
} from "@/engine/shift4/retailTerminal"
import { requireShift4OperatorFromRequest } from "@/lib/api/shift4OperatorAuth"
import { shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** The check takes at most one small field, so anything larger is a mistake. */
const MAX_BODY_BYTES = 512

/** `readerId` is a PineTree row id. A Shift4 terminal ID can never match this. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The ONLY key a caller may send. Everything else is server-derived. */
const ALLOWED_BODY_KEYS = new Set(["readerId"])

async function readReaderSelection(request: NextRequest): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), {
      status: 413,
      code: "payload_too_large",
    })
  }

  const raw = (await request.text()).trim()
  if (!raw) return null

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
    throw Object.assign(new Error("Request body must be a JSON object"), {
      status: 400,
      code: "body_not_accepted",
    })
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Request body must be a JSON object"), {
      status: 400,
      code: "body_not_accepted",
    })
  }

  const body = parsed as Record<string, unknown>
  const extra = Object.keys(body).filter((key) => !ALLOWED_BODY_KEYS.has(key))
  if (extra.length > 0) {
    // Rejecting by allow-list is what stops a caller from smuggling a
    // terminalId, serialNumber, manufacturer, environment or merchantId in.
    throw Object.assign(
      new Error(
        "Only readerId is accepted. Merchant, provider, channel, environment, terminal ID and serial number are all server-derived."
      ),
      { status: 403, code: "caller_input_not_accepted" }
    )
  }

  if (body.readerId === undefined || body.readerId === null) return null

  const readerId = typeof body.readerId === "string" ? body.readerId.trim() : ""
  if (!UUID_PATTERN.test(readerId)) {
    throw Object.assign(new Error("readerId must be a PineTree terminal reader identifier"), {
      status: 400,
      code: "invalid_input",
    })
  }
  return readerId
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  response.headers.set("Pragma", "no-cache")
  return response
}

export async function POST(request: NextRequest) {
  try {
    // Operator authorization precedes body inspection. An unauthorized caller
    // must not be able to learn anything from how its body was parsed.
    const merchantId = await requireShift4OperatorFromRequest(request)
    const readerId = await readReaderSelection(request)

    // The local-configuration projection first: it is what tells us whether a
    // device check is even meaningful, and it sends nothing.
    const verification = await verifyShift4RetailTerminalReadiness(merchantId)

    // Only a configured terminal is worth asking Shift4 about. With none
    // configured this route completes having sent zero provider requests.
    let deviceStatus: Awaited<ReturnType<typeof verifyShift4RetailDeviceStatus>> | null = null
    let deviceStatusError: { code: string; message: string } | null = null
    if (verification.configured) {
      try {
        deviceStatus = await verifyShift4RetailDeviceStatus({ merchantId, readerId })
      } catch (error) {
        if (error instanceof Shift4DeviceStatusError) {
          // A selection requirement is a caller-correctable condition, so it is
          // surfaced with its code. Everything else stays generic.
          deviceStatusError = {
            code: error.code,
            message:
              error.code === "selection_required" || error.code === "serial_number_missing"
                ? error.message
                : "The Shift4 device status check did not complete.",
          }
        } else {
          deviceStatusError = {
            code: "provider_error",
            message: "The Shift4 device status check did not complete.",
          }
        }
      }
    }

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
        // True only when a real /devices/getstatus request actually went out.
        providerCallPerformed: deviceStatus !== null,
        awaiting: verification.awaiting,
        proves: verification.proves,
        doesNotProve: verification.doesNotProve,
        // Explicitly constructed, never spread: a future Engine field cannot
        // widen this into carrying a serial number, a token, or a raw response.
        deviceStatus: deviceStatus
          ? {
              readerId: deviceStatus.readerId,
              label: deviceStatus.label,
              model: deviceStatus.model,
              maskedSerial: deviceStatus.maskedSerial,
              manufacturer: deviceStatus.manufacturer,
              deviceClassification: deviceStatus.deviceClassification,
              deviceNote: deviceStatus.deviceNote,
              cloudRegistered: deviceStatus.cloudRegistered,
              cloudConnected: deviceStatus.cloudConnected,
              offlineMode: deviceStatus.offlineMode,
              connectivityState: deviceStatus.connectivityState,
              verifiedAt: deviceStatus.verifiedAt,
              correlationId: deviceStatus.correlationId,
            }
          : null,
        deviceStatusError,
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
