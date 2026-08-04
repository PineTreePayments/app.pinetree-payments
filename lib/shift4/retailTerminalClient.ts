/**
 * Shift4 Retail terminal — the browser-side client.
 *
 * Extracted from the React card so the security-critical behavior (single
 * dispatch, no automatic retry, no server-derived field ever sent, error
 * narrowing) is a pure function that can be tested directly instead of inferred
 * from a component.
 *
 * ── No server-derived input ──────────────────────────────────────────────────
 * The request types below have no merchantId, provider, environment, or channel
 * field, so this module cannot express one even by mistake. The server rejects
 * them too; this is the first of the two barriers, not the only one.
 *
 * ── No automatic retry ───────────────────────────────────────────────────────
 * Exactly one request is dispatched per call, on every outcome. A repeat is
 * always an operator decision.
 */

export const SHIFT4_RETAIL_TERMINAL_PATH = "/api/internal/shift4/retail-terminal"
export const SHIFT4_RETAIL_TERMINAL_VERIFICATION_PATH =
  "/api/internal/shift4/retail-terminal/verification"

export const RETAIL_TERMINAL_TIMEOUT_MS = 30_000

/**
 * How long a device-status answer is treated as current, in minutes.
 *
 * Mirrors `SHIFT4_TERMINAL_EVIDENCE_FRESHNESS_MS` in the Engine. Duplicated as a
 * plain number rather than imported so this browser module keeps no dependency
 * on server code; the Engine remains the enforcing side, and a test asserts the
 * two agree.
 */
export const EVIDENCE_FRESHNESS_MINUTES = 5

/** Exactly the fields the configuration routes are permitted to return. */
export type RetailTerminalView = {
  readerId: string | null
  terminalId: string | null
  model: string | null
  maskedSerial: string | null
  locationId: string | null
  integrationMethod: string
  environment: string
  channel: string
  configured: boolean
  connectivityState: string
  evidenceSource: string
  lastVerifiedAt: string | null
  correlationId: string
  readinessState: string
  retailProcessingEnabled: boolean
  /** Every Shift4 reader this merchant owns, so the operator can name one. */
  readers: RetailTerminalReader[]
}

/** One selectable terminal. Safe metadata only — never a full serial number. */
export type RetailTerminalReader = {
  readerId: string | null
  label: string | null
  terminalId: string | null
  model: string | null
  maskedSerial: string | null
  locationId: string | null
  isDefault: boolean
  connectivityState: string
  readinessState: string
  lastVerifiedAt: string | null
}

/**
 * The safe device-status result. Three documented Shift4 flags plus PineTree's
 * own normalization. There is no raw provider response, no serial number, no
 * access token, and no Client GUID — none of those is named here, so none can
 * be displayed even if a server were to send it.
 */
export type RetailDeviceStatus = {
  readerId: string
  label: string | null
  model: string | null
  maskedSerial: string | null
  manufacturer: string | null
  deviceClassification: string
  deviceNote: string
  cloudRegistered: string | null
  cloudConnected: string | null
  offlineMode: string | null
  connectivityState: string
  verifiedAt: string | null
  correlationId: string
}

/** The verification adds only these, and never a provider payload. */
export type RetailTerminalVerification = RetailTerminalView & {
  providerCallPerformed: boolean
  awaiting: string[]
  proves: string
  doesNotProve: string[]
  /** Present only when a real /devices/getstatus request was performed. */
  deviceStatus: RetailDeviceStatus | null
  /** Present when the device check was attempted and did not complete. */
  deviceStatusError: { code: string; message: string } | null
}

export type RetailTerminalFailure = {
  message: string
  correlationId: string | null
  /** True when the operator should stop and review rather than click again. */
  reviewRequired: boolean
}

export type RetailTerminalOutcome<T> =
  | { status: "success"; result: T }
  | { status: "failure"; failure: RetailTerminalFailure }

/** The only fields an operator may submit. No server-derived field exists here. */
export type RetailTerminalFormInput = {
  intent: "create" | "replace"
  terminalId: string
  model: string
  serialNumber: string
  locationId: string
}

export type RetailTerminalDeps = {
  getBearerToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Whether the operator may dispatch a terminal request right now. */
export function canSubmitTerminalRequest(state: { submitting: boolean }): boolean {
  return !state.submitting
}

/** Client-side completeness check. The server validates independently. */
export function isTerminalFormComplete(form: RetailTerminalFormInput): boolean {
  return form.terminalId.trim().length > 0 && form.model.trim().length > 0
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/**
 * Rebuild the view field by field.
 *
 * A future server addition cannot widen what this interface displays, because
 * nothing is copied that is not named here.
 */
function readView(data: Record<string, unknown>): RetailTerminalView {
  return {
    readerId: readStringOrNull(data.readerId),
    terminalId: readStringOrNull(data.terminalId),
    model: readStringOrNull(data.model),
    maskedSerial: readStringOrNull(data.maskedSerial),
    locationId: readStringOrNull(data.locationId),
    integrationMethod: readString(data.integrationMethod),
    environment: readString(data.environment),
    channel: readString(data.channel),
    configured: data.configured === true,
    connectivityState: readString(data.connectivityState),
    evidenceSource: readString(data.evidenceSource),
    lastVerifiedAt: readStringOrNull(data.lastVerifiedAt),
    correlationId: readString(data.correlationId),
    readinessState: readString(data.readinessState),
    retailProcessingEnabled: data.retailProcessingEnabled === true,
    readers: readReaders(data.readers),
  }
}

function readReaders(value: unknown): RetailTerminalReader[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const data = entry as Record<string, unknown>
    return [
      {
        readerId: readStringOrNull(data.readerId),
        label: readStringOrNull(data.label),
        terminalId: readStringOrNull(data.terminalId),
        model: readStringOrNull(data.model),
        maskedSerial: readStringOrNull(data.maskedSerial),
        locationId: readStringOrNull(data.locationId),
        isDefault: data.isDefault === true,
        connectivityState: readString(data.connectivityState),
        readinessState: readString(data.readinessState),
        lastVerifiedAt: readStringOrNull(data.lastVerifiedAt),
      },
    ]
  })
}

function readVerification(data: Record<string, unknown>): RetailTerminalVerification {
  const view = readView(data)
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
    // The verification response does not re-send the reader list; the card
    // already holds it from the GET.
    readers: view.readers,
    providerCallPerformed: data.providerCallPerformed === true,
    awaiting: readStringList(data.awaiting),
    proves: readString(data.proves),
    doesNotProve: readStringList(data.doesNotProve),
    deviceStatus: readDeviceStatus(data.deviceStatus),
    deviceStatusError: readDeviceStatusError(data.deviceStatusError),
  }
}

/** Rebuilt field by field, exactly like the view, for the same reason. */
function readDeviceStatus(value: unknown): RetailDeviceStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const readerId = readString(data.readerId)
  if (!readerId) return null
  return {
    readerId,
    label: readStringOrNull(data.label),
    model: readStringOrNull(data.model),
    maskedSerial: readStringOrNull(data.maskedSerial),
    manufacturer: readStringOrNull(data.manufacturer),
    deviceClassification: readString(data.deviceClassification),
    deviceNote: readString(data.deviceNote),
    cloudRegistered: readStringOrNull(data.cloudRegistered),
    cloudConnected: readStringOrNull(data.cloudConnected),
    offlineMode: readStringOrNull(data.offlineMode),
    connectivityState: readString(data.connectivityState),
    verifiedAt: readStringOrNull(data.verifiedAt),
    correlationId: readString(data.correlationId),
  }
}

function readDeviceStatusError(value: unknown): { code: string; message: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const message = readString(data.message)
  if (!message) return null
  return { code: readString(data.code), message }
}

/**
 * One request. Shared by all three operations so the single-dispatch and
 * error-narrowing rules exist in exactly one place.
 */
async function dispatch<T>(
  deps: RetailTerminalDeps,
  init: { path: string; method: "GET" | "POST"; body?: string },
  parse: (data: Record<string, unknown>) => T
): Promise<RetailTerminalOutcome<T>> {
  const bearer = await deps.getBearerToken().catch(() => null)
  if (!bearer) {
    return {
      status: "failure",
      failure: {
        message: "Your session has expired. Sign in again before continuing.",
        correlationId: null,
        reviewRequired: false,
      },
    }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? RETAIL_TERMINAL_TIMEOUT_MS)

  try {
    const response = await fetchImpl(init.path, {
      method: init.method,
      headers: init.body
        ? { authorization: `Bearer ${bearer}`, "content-type": "application/json" }
        : { authorization: `Bearer ${bearer}` },
      body: init.body,
      cache: "no-store",
      signal: controller.signal,
    })

    const body = (await response.json().catch(() => null)) as
      | {
          ok?: boolean
          data?: Record<string, unknown>
          error?: { message?: string; correlationId?: string }
        }
      | null

    if (response.ok && body?.ok && body.data) {
      return { status: "success", result: parse(body.data) }
    }

    // Only the standard envelope's operator-safe message and correlation ID are
    // surfaced. The provider body, headers, and database internals never
    // reach here.
    return {
      status: "failure",
      failure: {
        message: body?.error?.message || "The Shift4 terminal request did not succeed.",
        correlationId: body?.error?.correlationId ?? null,
        reviewRequired: response.status >= 500,
      },
    }
  } catch (error) {
    // The thrown value is inspected only for abort, never stringified: a
    // transport failure must not become a channel for detail.
    const aborted = error instanceof Error && error.name === "AbortError"
    return {
      status: "failure",
      failure: {
        message: aborted
          ? "The request timed out before PineTree answered."
          : "The request could not be completed.",
        correlationId: null,
        reviewRequired: true,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Read the current configuration. */
export function loadRetailTerminal(
  deps: RetailTerminalDeps
): Promise<RetailTerminalOutcome<RetailTerminalView>> {
  return dispatch(deps, { path: SHIFT4_RETAIL_TERMINAL_PATH, method: "GET" }, readView)
}

/**
 * Create or replace the configuration.
 *
 * The body is assembled from exactly five named fields; `intent` is required, so
 * an edit is always a deliberate choice rather than an implied upsert.
 */
export function submitRetailTerminal(
  deps: RetailTerminalDeps,
  form: RetailTerminalFormInput
): Promise<RetailTerminalOutcome<RetailTerminalView>> {
  return dispatch(
    deps,
    {
      path: SHIFT4_RETAIL_TERMINAL_PATH,
      method: "POST",
      body: JSON.stringify({
        intent: form.intent,
        terminalId: form.terminalId.trim(),
        model: form.model.trim(),
        serialNumber: form.serialNumber.trim(),
        locationId: form.locationId.trim(),
      }),
    },
    readView
  )
}

/**
 * Run the explicit readiness check, optionally naming which reader to verify.
 *
 * `readerId` is the ONLY field ever sent, and it is a PineTree row id — never a
 * Shift4 terminal ID, serial number, manufacturer, environment, or merchant.
 * Exactly one request is dispatched; there is no retry on any outcome.
 */
export function submitRetailTerminalVerification(
  deps: RetailTerminalDeps,
  readerId?: string | null
): Promise<RetailTerminalOutcome<RetailTerminalVerification>> {
  const selected = String(readerId ?? "").trim()
  return dispatch(
    deps,
    {
      path: SHIFT4_RETAIL_TERMINAL_VERIFICATION_PATH,
      method: "POST",
      body: selected ? JSON.stringify({ readerId: selected }) : undefined,
    },
    readVerification
  )
}
