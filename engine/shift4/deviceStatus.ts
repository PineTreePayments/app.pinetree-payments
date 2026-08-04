/**
 * Shift4 Retail device status — the one real provider operation this phase adds.
 *
 * Flow: operator action -> admin route -> THIS module -> shared Shift4 REST
 * client -> `POST /devices/getstatus` (Commerce Engine For Cloud).
 *
 * ── What makes this safe to reach production with no hardware ────────────────
 * It refuses to send anything unless a real merchant-owned Shift4 reader exists
 * with a real serial number and a resolvable documented manufacturer. With no
 * terminal configured — the state at deployment — every call returns
 * `not_configured` having sent zero requests. It moves no money, creates no
 * transaction, and touches no card data.
 *
 * ── Exactly one request per operator action ──────────────────────────────────
 * There is no retry here and none in the client for this operation. A failure
 * is reported as a failure; the operator decides whether to check again.
 *
 * SECURITY: the access token is decrypted, handed to the client, and never
 * returned, logged, or attached to any result. The raw Shift4 body is read
 * inside a single closure that extracts three documented flags and is then
 * discarded; it is never returned, stored, or logged.
 */

import { randomUUID } from "node:crypto"

import { getShift4RestAccessToken } from "@/database/merchantShift4RestConnections"
import { getMerchantSettings } from "@/database/merchants"
import {
  getMerchantTerminalReaderById,
  listMerchantTerminalReaders,
  recordTerminalReaderProviderStatus,
  type MerchantTerminalReader,
} from "@/database/merchantTerminalReaders"
import {
  buildShift4CloudDeviceStatusRequest,
  classifyShift4Device,
  readShift4CloudDeviceStatusFlags,
  Shift4CloudRequestError,
  type Shift4CloudDeviceStatusFlags,
} from "@/providers/shift4/commerce-engine/cloud"
import { shift4RestRequest } from "@/providers/shift4/rest/client"
import { formatShift4DateTime } from "@/providers/shift4/rest/dateTime"

import { logShift4Event } from "./observability"
import { readShift4FeatureFlags } from "./readiness"
import {
  mapShift4CloudDeviceStatus,
  SHIFT4_READER_STATUS_BY_STATE,
  type Shift4TerminalConnectivityState,
} from "./terminalReadiness"

export const SHIFT4_PROVIDER_KEY = "shift4" as const

/** Retail is the only channel a physical device can belong to. Not a parameter. */
export const SHIFT4_DEVICE_STATUS_CHANNEL = "retail" as const

export class Shift4DeviceStatusError extends Error {
  readonly code:
    | "rest_disabled"
    | "not_configured"
    | "selection_required"
    | "reader_not_found"
    | "serial_number_missing"
    | "manufacturer_unresolved"
    | "simulated_reader"
    | "connection_unavailable"
    | "provider_error"

  constructor(message: string, code: Shift4DeviceStatusError["code"]) {
    super(message)
    this.name = "Shift4DeviceStatusError"
    this.code = code
  }
}

/** Everything the admin surface may see. Deliberately narrow. */
export type Shift4DeviceStatusResult = Readonly<{
  readerId: string
  label: string | null
  model: string | null
  maskedSerial: string | null
  /** Resolved from the stored model; never sent by a caller. */
  manufacturer: string | null
  deviceClassification: string
  deviceNote: string
  cloudRegistered: "Y" | "N" | null
  cloudConnected: "Y" | "N" | null
  offlineMode: "Y" | "N" | "U" | null
  connectivityState: Shift4TerminalConnectivityState
  verifiedAt: string
  correlationId: string
  providerCallPerformed: true
}>

/** Masks all but the last four characters. Mirrors the terminal-card rule. */
function maskSerial(serial: string | null | undefined): string | null {
  const value = String(serial ?? "").trim()
  if (!value) return null
  if (value.length <= 4) return "*".repeat(value.length)
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`
}

type ResolvedDevice = Readonly<{
  reader: MerchantTerminalReader
  manufacturer: string
  serialNumber: string
}>

/**
 * Re-resolve a reader under the merchant's own scope and prove it can address a
 * cloud device at all. Every rejection here happens BEFORE any network call.
 */
export async function resolveShift4CloudDevice(
  merchantId: string,
  readerId: string
): Promise<ResolvedDevice> {
  const reader = await getMerchantTerminalReaderById(merchantId, readerId)
  if (!reader || reader.provider !== SHIFT4_PROVIDER_KEY) {
    // Same error for "belongs to another merchant" and "does not exist": the
    // caller learns nothing about other tenants' readers either way.
    throw new Shift4DeviceStatusError("Shift4 Retail reader is unavailable", "reader_not_found")
  }
  if (reader.simulated) {
    throw new Shift4DeviceStatusError(
      "A simulated reader cannot be checked against Shift4",
      "simulated_reader"
    )
  }

  const serialNumber = String(reader.serial_number ?? "").trim()
  if (!serialNumber) {
    // Commerce Engine For Cloud addresses the device by serial number, so a row
    // without one cannot be checked no matter how complete it otherwise looks.
    throw new Shift4DeviceStatusError(
      "This reader has no serial number recorded. Commerce Engine For Cloud addresses a device by manufacturer and serial number.",
      "serial_number_missing"
    )
  }

  const classification = classifyShift4Device(reader.device_type)
  if (!classification.manufacturer) {
    throw new Shift4DeviceStatusError(
      "The recorded device model does not resolve to a documented Shift4 manufacturer.",
      "manufacturer_unresolved"
    )
  }

  return Object.freeze({ reader, manufacturer: classification.manufacturer, serialNumber })
}

/**
 * Send exactly one `POST /devices/getstatus` for one merchant-owned reader.
 *
 * `merchantTimeZone` produces Shift4's merchant-local `dateTime`. Server UTC is
 * not used blindly: near midnight it would report the wrong local date, which
 * is the kind of error that quietly corrupts a business date.
 */
export async function checkShift4DeviceStatus(input: {
  merchantId: string
  readerId: string
  accessToken: string
  merchantTimeZone?: string | null
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<Shift4DeviceStatusResult> {
  const { reader, manufacturer, serialNumber } = await resolveShift4CloudDevice(
    input.merchantId,
    input.readerId
  )

  const now = input.now ?? new Date()
  const correlationId = randomUUID()

  let body
  try {
    body = buildShift4CloudDeviceStatusRequest({
      dateTime: formatShift4DateTime(now, input.merchantTimeZone || undefined),
      manufacturer,
      serialNumber,
    })
  } catch (error) {
    if (error instanceof Shift4CloudRequestError) {
      throw new Shift4DeviceStatusError(
        "The device status request could not be built from the stored configuration.",
        "manufacturer_unresolved"
      )
    }
    throw error
  }

  // The parsed body is read here and nowhere else. Only three documented flags
  // leave this closure; the body itself is not captured beyond it.
  let flags: Shift4CloudDeviceStatusFlags = {
    cloudRegistered: null,
    cloudConnected: null,
    offlineMode: null,
  }

  await shift4RestRequest({
    operation: "device_status",
    accessToken: input.accessToken,
    body,
    context: { correlationId, merchantId: input.merchantId },
    fetchImpl: input.fetchImpl,
    onParsedBody: (parsed) => {
      flags = readShift4CloudDeviceStatusFlags(parsed)
    },
  })

  const connectivityState = mapShift4CloudDeviceStatus(flags)
  const verifiedAt = now.toISOString()

  // Persist the namespaced provider status so freshness and later reads have a
  // source-specific value that cannot be confused with local configuration.
  await recordTerminalReaderProviderStatus({
    merchantId: input.merchantId,
    readerId: reader.id,
    provider: SHIFT4_PROVIDER_KEY,
    status: SHIFT4_READER_STATUS_BY_STATE[connectivityState === "unverified" ? "unknown" : connectivityState],
    observedAt: verifiedAt,
  })

  const classification = classifyShift4Device(reader.device_type)

  // Routed through the shared logger so field sanitization applies. The three
  // flags are documented status values — not credentials, not card data.
  logShift4Event("info", "shift4_device_status_checked", {
    merchantId: input.merchantId,
    terminalReaderId: reader.id,
    correlationId,
    connectivityState,
    cloudRegistered: flags.cloudRegistered,
    cloudConnected: flags.cloudConnected,
    offlineMode: flags.offlineMode,
  })

  return Object.freeze({
    readerId: reader.id,
    label: reader.label ?? null,
    model: reader.device_type ?? null,
    maskedSerial: maskSerial(reader.serial_number),
    manufacturer,
    deviceClassification: classification.classification,
    deviceNote: classification.note,
    cloudRegistered: flags.cloudRegistered,
    cloudConnected: flags.cloudConnected,
    offlineMode: flags.offlineMode,
    connectivityState,
    verifiedAt,
    correlationId,
    providerCallPerformed: true as const,
  })
}

/**
 * The operator-initiated Shift4 device check.
 *
 * Every gate below runs BEFORE any credential is decrypted or any request is
 * built, so the "nothing configured" case — the state this deploys in — costs
 * exactly zero Shift4 requests.
 *
 * `readerId` is required whenever the merchant owns more than one Shift4
 * reader. Silently checking `readers[0]` would report one device's health under
 * another device's name, which is precisely the multi-terminal bug this whole
 * effort exists to prevent. One action always produces at most one request.
 */
export async function verifyShift4RetailDeviceStatus(input: {
  merchantId: string
  readerId?: string | null
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<Shift4DeviceStatusResult> {
  const flags = readShift4FeatureFlags()
  if (!flags.restApi) {
    throw new Shift4DeviceStatusError(
      "The Shift4 REST integration is disabled for this deployment.",
      "rest_disabled"
    )
  }

  const readers = await listMerchantTerminalReaders(input.merchantId, SHIFT4_PROVIDER_KEY)
  if (!readers || readers.length === 0) {
    // No device, so nothing to ask Shift4 about. No request is sent.
    throw new Shift4DeviceStatusError(
      "No Shift4 terminal is configured for this merchant.",
      "not_configured"
    )
  }

  const requested = String(input.readerId ?? "").trim()
  if (!requested && readers.length > 1) {
    throw new Shift4DeviceStatusError(
      "Choose which Shift4 terminal to verify.",
      "selection_required"
    )
  }

  const readerId = requested || readers[0].id
  // Prove the device is addressable before touching the credential store.
  await resolveShift4CloudDevice(input.merchantId, readerId)

  const connection = await getShift4RestAccessToken(input.merchantId, {
    channel: SHIFT4_DEVICE_STATUS_CHANNEL,
    // The Retail credential must answer for a Retail device. A legacy shared
    // token could succeed while proving nothing about Retail.
    allowLegacySharedCredential: false,
  })
  if (!connection) {
    throw new Shift4DeviceStatusError(
      "No stored Shift4 Retail credential is available for this merchant.",
      "connection_unavailable"
    )
  }

  const settings = await getMerchantSettings(input.merchantId).catch(() => null)

  logShift4Event("info", "shift4_device_status_requested", {
    merchantId: input.merchantId,
    channel: SHIFT4_DEVICE_STATUS_CHANNEL,
    terminalReaderId: readerId,
  })

  // The decrypted token exists only as this argument.
  return await checkShift4DeviceStatus({
    merchantId: input.merchantId,
    readerId,
    accessToken: connection.accessToken,
    merchantTimeZone: (settings as { timezone?: string | null } | null)?.timezone ?? null,
    now: input.now,
    fetchImpl: input.fetchImpl,
  })
}
