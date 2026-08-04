/**
 * `POST /devices/getstatus` — the Commerce Engine For Cloud variant.
 *
 * SOURCE: `components.schemas.devices_getstatus_comengcloud` in the Shift4
 * Payment API OpenAPI 3.1 spec v1.7.58.
 *
 *   required: [dateTime, device]
 *   dateTime: ISO 8601 with timezone offset, MERCHANT-LOCAL
 *   device:   required [cloud, manufacturer, serialNumber]
 *     cloud:        boolean, must be true to route to the device
 *     manufacturer: enum Ingenico|Innowi|PAX|Verifone|Castles|Miura
 *     serialNumber: string, max 64
 *
 * The On-Premise variant (`devices_getstatus_comengdevice`) requires ONLY
 * `dateTime` and has no `device` object, because it is addressed by the local
 * network URL. That schema is never used here.
 *
 * Response (200), transcribed:
 *   result[0].cloudRegistered  "Y" | "N"
 *   result[0].cloudConnected   "Y" | "N"
 *   result[0].offlineMode      "Y" | "N" | "U"
 *
 * "U" is documented as: "Offline status is unknown. For example, when sending
 * the Get Device Status command via Commerce Engine For Cloud and the device is
 * not connected." It is therefore NOT a synonym for online.
 *
 * SECURITY: pure. Builds a body and reads three documented fields. No fetch, no
 * credential, no logging. The caller owns transport.
 */

import {
  SHIFT4_CLOUD_DEVICE_MANUFACTURERS,
  SHIFT4_CLOUD_SERIAL_NUMBER_MAX_LENGTH,
  type Shift4CloudDevice,
  type Shift4CloudDeviceManufacturer,
} from "./contract"

export class Shift4CloudRequestError extends Error {
  readonly code:
    | "invalid_manufacturer"
    | "invalid_serial_number"
    | "invalid_date_time"
    | "invalid_purchase_card"
    | "invalid_authorization_code"

  constructor(message: string, code: Shift4CloudRequestError["code"]) {
    super(message)
    this.name = "Shift4CloudRequestError"
    this.code = code
  }
}

/** The exact documented request body. No additional fields are permitted. */
export type Shift4CloudDeviceStatusRequest = Readonly<{
  dateTime: string
  device: Shift4CloudDevice
}>

export function isShift4CloudManufacturer(value: unknown): value is Shift4CloudDeviceManufacturer {
  return (
    typeof value === "string" &&
    (SHIFT4_CLOUD_DEVICE_MANUFACTURERS as readonly string[]).includes(value)
  )
}

/**
 * ISO 8601 with a REQUIRED timezone offset. A trailing `Z` is rejected on
 * purpose: Shift4 documents merchant-local time with an offset, and `Z` is a
 * UTC instant. Accepting it would silently send the wrong local date near
 * midnight, which is exactly the class of error that corrupts a business date.
 */
const ISO_8601_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?[+-]\d{2}:\d{2}$/

export function buildShift4CloudDeviceStatusRequest(input: {
  dateTime: string
  manufacturer: string
  serialNumber: string
}): Shift4CloudDeviceStatusRequest {
  if (!ISO_8601_WITH_OFFSET.test(String(input.dateTime || "").trim())) {
    throw new Shift4CloudRequestError(
      "dateTime must be ISO 8601 merchant-local time including a timezone offset.",
      "invalid_date_time"
    )
  }

  if (!isShift4CloudManufacturer(input.manufacturer)) {
    throw new Shift4CloudRequestError(
      "device.manufacturer must be one of the documented Shift4 manufacturers.",
      "invalid_manufacturer"
    )
  }

  const serialNumber = String(input.serialNumber || "").trim()
  if (!serialNumber || serialNumber.length > SHIFT4_CLOUD_SERIAL_NUMBER_MAX_LENGTH) {
    throw new Shift4CloudRequestError(
      "device.serialNumber is required and must be at most 64 characters.",
      "invalid_serial_number"
    )
  }

  // Frozen and explicitly constructed: a caller cannot widen the body, and no
  // On-Premise-only or undocumented field can be added by spreading.
  return Object.freeze({
    dateTime: input.dateTime,
    device: Object.freeze({
      cloud: true as const,
      manufacturer: input.manufacturer,
      serialNumber,
    }),
  })
}

/** The three documented flags, or null when Shift4 did not publish one. */
export type Shift4CloudDeviceStatusFlags = Readonly<{
  cloudRegistered: "Y" | "N" | null
  cloudConnected: "Y" | "N" | null
  offlineMode: "Y" | "N" | "U" | null
}>

const readFlag = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
  if (typeof value !== "string") return null
  const upper = value.trim().toUpperCase()
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : null
}

/**
 * Read the three documented device-status flags out of a parsed Shift4 body.
 *
 * Anything unexpected — a missing field, an undocumented string, a non-array
 * envelope — yields `null` for that flag rather than a guess. `null` is what
 * drives the `unknown` state downstream; it must never collapse into "online".
 *
 * The parsed body itself is never returned, stored, or logged by this function.
 */
export function readShift4CloudDeviceStatusFlags(body: unknown): Shift4CloudDeviceStatusFlags {
  const empty: Shift4CloudDeviceStatusFlags = Object.freeze({
    cloudRegistered: null,
    cloudConnected: null,
    offlineMode: null,
  })

  if (!body || typeof body !== "object") return empty
  const result = (body as { result?: unknown }).result
  if (!Array.isArray(result) || result.length === 0) return empty
  const entry = result[0]
  if (!entry || typeof entry !== "object") return empty

  const record = entry as Record<string, unknown>
  return Object.freeze({
    cloudRegistered: readFlag(record.cloudRegistered, ["Y", "N"] as const),
    cloudConnected: readFlag(record.cloudConnected, ["Y", "N"] as const),
    offlineMode: readFlag(record.offlineMode, ["Y", "N", "U"] as const),
  })
}
