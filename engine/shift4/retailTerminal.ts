/**
 * PineTree Engine — Shift4 Retail terminal configuration and readiness.
 *
 * Layering: Admin operator UI -> authenticated PineTree API -> THIS module ->
 * existing terminal database services. No Shift4 request is made from here, by
 * design (see "Why nothing is sent" below).
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Uses the EXISTING `merchant_terminal_readers` table and its existing service
 * functions. No Shift4-specific terminal table, no migration, and no SQL: every
 * value an operator supplies already has a column.
 *
 *   terminal ID    -> provider_reader_id
 *   device model   -> device_type
 *   serial number  -> serial_number      (returned masked, never in full)
 *   location       -> terminal_location_id (an existing merchant location row)
 *
 * `provider` is pinned to "shift4" in every read and every write, so a Stripe or
 * FluidPay reader can never be read, rewritten, or counted here.
 *
 * ── Why nothing is sent to Shift4 ────────────────────────────────────────────
 * The Payment Platform REST API documents nine operations and none reports
 * terminal or device status; the Commerce Engine transport, where a device
 * session would live, is documentation-blocked. Rather than invent an endpoint,
 * verification checks PineTree's OWN configuration and labels the result exactly
 * that: locally configured, provider connectivity unverified. See
 * `terminalReadiness.ts`.
 *
 * ── What this never does ─────────────────────────────────────────────────────
 * No authorization, sale, capture, refund, void, tokenization, or Access Token
 * Exchange is reachable from this module. It writes no feature flag, grants no
 * capability, and never marks card processing verified or certified.
 */

import { randomUUID } from "node:crypto"

import { getMerchantTerminalLocationById } from "@/database/merchantTerminalLocations"
import {
  listMerchantTerminalReaders,
  replaceMerchantTerminalReaderById,
  upsertMerchantTerminalReader,
  type MerchantTerminalReader,
} from "@/database/merchantTerminalReaders"
import { getShift4RestConfig, type Shift4RestEnvironment } from "@/providers/shift4/rest/config"

import { logShift4Event } from "./observability"
import { readShift4FeatureFlags } from "./readiness"
import {
  projectShift4TerminalReadiness,
  resolveShift4TerminalConnectivity,
  type Shift4TerminalConnectivityEvidence,
  type Shift4TerminalEvidenceSource,
  type Shift4TerminalReadinessState,
} from "./terminalReadiness"

/* ────────────────────────────────────────────────────────────────────────────
   Server-fixed identity

   None of these is a parameter anywhere in this module. A caller — route, test,
   or future Engine module — has no way to express a different provider, channel,
   or integration method, so the browser cannot influence them even indirectly.
   ──────────────────────────────────────────────────────────────────────────── */

export const SHIFT4_TERMINAL_PROVIDER = "shift4" as const
export const SHIFT4_TERMINAL_CHANNEL = "retail" as const

/**
 * How PineTree would reach a Shift4 Retail device.
 *
 * A PineTree-side constant describing this integration's architecture, not a
 * value Shift4 returned and not an operator input. The Commerce Engine client
 * is currently documentation-blocked, which `commerceEngineConfigured` reports
 * separately.
 */
export const SHIFT4_TERMINAL_INTEGRATION_METHOD = "commerce_engine" as const

/** The status written for a Shift4 terminal record PineTree configured itself. */
export const SHIFT4_TERMINAL_CONFIGURED_STATUS = "configured" as const

/* ────────────────────────────────────────────────────────────────────────────
   Operator input

   Validation is PineTree input hygiene, NOT a transcription of a Shift4 format
   rule: the REST description documents `device.terminalId` only as a string on
   a transaction result, and no serial or model format is documented anywhere in
   the sources this integration is built from. Nothing here is presented to an
   operator as a Shift4 requirement.
   ──────────────────────────────────────────────────────────────────────────── */

/** The only fields an operator may supply. Everything else is server-derived. */
export const SHIFT4_TERMINAL_INPUT_FIELDS = [
  "intent",
  "terminalId",
  "model",
  "serialNumber",
  "locationId",
] as const

export type Shift4TerminalIntent = "create" | "replace"

export type Shift4RetailTerminalInput = {
  intent: Shift4TerminalIntent
  terminalId: string
  model: string
  serialNumber: string | null
  locationId: string | null
}

const TERMINAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/
const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Errors an operator interface may act on, carrying no provider or SQL detail. */
export class Shift4RetailTerminalError extends Error {
  readonly code:
    | "rest_disabled"
    | "not_configured"
    | "invalid_input"
    | "terminal_already_configured"
    | "terminal_not_configured"
    | "location_not_found"
    | "configuration_unavailable"

  constructor(message: string, code: Shift4RetailTerminalError["code"]) {
    super(message)
    this.name = "Shift4RetailTerminalError"
    this.code = code
  }
}

const invalid = (message: string) => new Shift4RetailTerminalError(message, "invalid_input")

/**
 * Validate and normalize operator input.
 *
 * Pure: no database, no configuration, no clock. Rejects rather than coerces, so
 * an operator is never silently given a record different from what they typed.
 */
export function normalizeShift4TerminalInput(raw: Record<string, unknown>): Shift4RetailTerminalInput {
  const unsupported = Object.keys(raw).filter(
    (key) => !(SHIFT4_TERMINAL_INPUT_FIELDS as readonly string[]).includes(key)
  )
  if (unsupported.length > 0) {
    // Named explicitly: silently dropping `merchantId` or `environment` would
    // let a caller believe it had selected one.
    throw invalid(`Unsupported field: ${unsupported.sort().join(", ")}`)
  }

  const intent = raw.intent
  if (intent !== "create" && intent !== "replace") {
    throw invalid("intent must be exactly \"create\" or \"replace\"")
  }

  const terminalId = typeof raw.terminalId === "string" ? raw.terminalId.trim() : ""
  if (!TERMINAL_ID_PATTERN.test(terminalId)) {
    throw invalid("terminalId must be 1-64 letters, digits, dot, hyphen, or underscore")
  }

  const model = typeof raw.model === "string" ? raw.model.trim() : ""
  if (!MODEL_PATTERN.test(model)) {
    throw invalid("model must be 1-40 letters, digits, space, dot, hyphen, or underscore")
  }

  // Optional. An empty string is treated as "not provided" rather than stored as
  // a blank serial.
  const serialRaw = typeof raw.serialNumber === "string" ? raw.serialNumber.trim() : ""
  if (serialRaw && !SERIAL_PATTERN.test(serialRaw)) {
    throw invalid("serialNumber must be 1-64 letters, digits, or hyphens")
  }

  const locationRaw = typeof raw.locationId === "string" ? raw.locationId.trim() : ""
  if (locationRaw && !UUID_PATTERN.test(locationRaw)) {
    throw invalid("locationId must be a PineTree terminal location identifier")
  }

  return {
    intent,
    terminalId,
    model,
    serialNumber: serialRaw || null,
    locationId: locationRaw || null,
  }
}

/**
 * Mask a device serial for display.
 *
 * Keeps the last four characters so an operator can tell two devices apart, and
 * nothing else. A value too short to mask meaningfully is hidden entirely rather
 * than partially revealed.
 */
export function maskSerialNumber(serial: string | null | undefined): string | null {
  const value = String(serial ?? "").trim()
  if (!value) return null
  if (value.length <= 4) return "•".repeat(value.length)
  return `${"•".repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`
}

/* ────────────────────────────────────────────────────────────────────────────
   Safe view
   ──────────────────────────────────────────────────────────────────────────── */

export type Shift4RetailTerminalView = Readonly<{
  /** PineTree's own row id. Not a Shift4 identifier. */
  readerId: string | null
  /** The Shift4 terminal identifier the operator configured. */
  terminalId: string | null
  model: string | null
  /** Masked. The full serial is never returned by any path. */
  maskedSerial: string | null
  locationId: string | null
  integrationMethod: typeof SHIFT4_TERMINAL_INTEGRATION_METHOD
  environment: Shift4RestEnvironment
  channel: typeof SHIFT4_TERMINAL_CHANNEL
  configured: boolean
  /** "online" requires provider evidence; it is not derivable from the row. */
  connectivityState: Shift4TerminalConnectivityEvidence["state"] | "not_configured"
  evidenceSource: Shift4TerminalEvidenceSource
  /** When PineTree last CHECKED. Null until an operator runs the check. */
  lastVerifiedAt: string | null
  correlationId: string
  readinessState: Shift4TerminalReadinessState
  /**
   * PineTree's local Retail feature gate. Reported, never written: configuring a
   * terminal does not enable Retail processing.
   */
  retailProcessingEnabled: boolean
}>

export type Shift4RetailTerminalVerification = Shift4RetailTerminalView &
  Readonly<{
    /** Always false in this phase. Stated as data so a UI cannot imply otherwise. */
    providerCallPerformed: boolean
    /** External facts PineTree still cannot establish on its own. */
    awaiting: readonly string[]
    proves: "local_terminal_configuration_present" | "no_local_terminal_configuration"
    doesNotProve: readonly [
      "provider_connectivity",
      "terminal_activation",
      "certification",
      "card_processing_approval",
    ]
  }>

/* ────────────────────────────────────────────────────────────────────────────
   Reads and writes
   ──────────────────────────────────────────────────────────────────────────── */

/** Resolve the deployment environment, which is server configuration only. */
function requireEnvironment(): Shift4RestEnvironment {
  try {
    return getShift4RestConfig().environment
  } catch {
    // Configuration errors name environment variables; the operator message
    // deliberately does not.
    throw new Shift4RetailTerminalError(
      "The Shift4 REST integration is not fully configured.",
      "not_configured"
    )
  }
}

function requireRestEnabled(): void {
  if (!readShift4FeatureFlags().restApi) {
    throw new Shift4RetailTerminalError(
      "The Shift4 REST integration is disabled for this deployment.",
      "rest_disabled"
    )
  }
}

/**
 * Load this merchant's Shift4 terminal rows.
 *
 * Always filtered to provider "shift4". Readers belonging to other providers are
 * never returned and therefore never counted, displayed, or modified.
 */
async function loadShift4Readers(merchantId: string): Promise<MerchantTerminalReader[]> {
  try {
    return await listMerchantTerminalReaders(merchantId, SHIFT4_TERMINAL_PROVIDER)
  } catch {
    // The database message is dropped rather than surfaced: it can name tables,
    // columns, and connection detail.
    throw new Shift4RetailTerminalError(
      "The Shift4 terminal configuration could not be read.",
      "configuration_unavailable"
    )
  }
}

/**
 * Build the safe view from a row plus evidence.
 *
 * Every field is assigned individually from a named source. The database row is
 * never spread, so a column added later cannot escape into an API response.
 */
function projectView(input: {
  reader: MerchantTerminalReader | null
  environment: Shift4RestEnvironment
  connectivity: Shift4TerminalConnectivityEvidence
  evidenceSource: Shift4TerminalEvidenceSource
  lastVerifiedAt: string | null
  correlationId: string
}): Shift4RetailTerminalView {
  const flags = readShift4FeatureFlags()
  const configured = Boolean(input.reader)

  return Object.freeze({
    readerId: input.reader ? String(input.reader.id) : null,
    terminalId: input.reader ? String(input.reader.provider_reader_id) : null,
    model: input.reader ? String(input.reader.device_type) : null,
    maskedSerial: input.reader ? maskSerialNumber(input.reader.serial_number) : null,
    locationId: input.reader?.terminal_location_id ?? null,
    integrationMethod: SHIFT4_TERMINAL_INTEGRATION_METHOD,
    environment: input.environment,
    channel: SHIFT4_TERMINAL_CHANNEL,
    configured,
    connectivityState: configured ? input.connectivity.state : "not_configured",
    evidenceSource: input.evidenceSource,
    lastVerifiedAt: input.lastVerifiedAt,
    correlationId: input.correlationId,
    readinessState: projectShift4TerminalReadiness({
      configuredCount: configured ? 1 : 0,
      configurationAvailable: true,
      restApiEnabled: flags.restApi,
      retailEnabled: flags.retail,
      connectivity: input.connectivity,
      // Configuring a terminal proves neither of these. Both are held false so
      // this projection can never reach "enabled" on its own.
      certified: false,
      productionAllowed: false,
    }).state,
    retailProcessingEnabled: flags.retail,
  })
}

/**
 * Read the merchant's current Shift4 Retail terminal configuration.
 *
 * Read-only. Makes no provider request and reports no connectivity evidence —
 * `evidenceSource` is "none" until the operator explicitly runs the check.
 */
export async function getShift4RetailTerminal(
  merchantId: string
): Promise<Shift4RetailTerminalView> {
  requireRestEnabled()
  const environment = requireEnvironment()
  const readers = await loadShift4Readers(merchantId)

  return projectView({
    // The oldest row is the merchant's terminal. This phase configures one.
    reader: readers[0] ?? null,
    environment,
    connectivity: await resolveShift4TerminalConnectivity(merchantId),
    evidenceSource: "none",
    lastVerifiedAt: null,
    correlationId: randomUUID(),
  })
}

/**
 * Create or replace the merchant's Shift4 Retail terminal record.
 *
 * `intent` must be stated by the operator and must match reality:
 *
 *   - "create" against an existing record fails, so a second row is never
 *     created by a repeated or stale submission;
 *   - "replace" against no record fails, so an edit cannot silently become a
 *     create.
 *
 * A replace updates the EXISTING row by id, which is what makes changing the
 * terminal ID an edit rather than a new device.
 */
export async function configureShift4RetailTerminal(
  merchantId: string,
  input: Shift4RetailTerminalInput
): Promise<Shift4RetailTerminalView> {
  requireRestEnabled()
  const environment = requireEnvironment()
  const readers = await loadShift4Readers(merchantId)
  const existing = readers[0] ?? null

  if (input.intent === "create" && existing) {
    throw new Shift4RetailTerminalError(
      "A Shift4 terminal is already configured. Use Replace to edit it.",
      "terminal_already_configured"
    )
  }
  if (input.intent === "replace" && !existing) {
    throw new Shift4RetailTerminalError(
      "No Shift4 terminal is configured yet. Use Create to add one.",
      "terminal_not_configured"
    )
  }

  // Tenant ownership: the location must belong to THIS merchant and to Shift4.
  // Checked here rather than trusted, because the id arrives from the browser.
  if (input.locationId) {
    const location = await getMerchantTerminalLocationById(merchantId, input.locationId).catch(
      () => null
    )
    if (!location || location.provider !== SHIFT4_TERMINAL_PROVIDER) {
      throw new Shift4RetailTerminalError(
        "That terminal location does not exist for this merchant.",
        "location_not_found"
      )
    }
  }

  const shared = {
    merchantId,
    provider: SHIFT4_TERMINAL_PROVIDER,
    providerReaderId: input.terminalId,
    terminalLocationId: input.locationId,
    // Derived, not operator input: the label is an internal display string and
    // adding a free-text field would widen the input surface for no benefit.
    label: `Shift4 ${input.model} ${input.terminalId}`.slice(0, 120),
    deviceType: input.model,
    serialNumber: input.serialNumber,
    // Never a status the readiness projector could read as live connectivity.
    status: SHIFT4_TERMINAL_CONFIGURED_STATUS,
  }

  const reader = existing
    ? await replaceMerchantTerminalReaderById({ ...shared, readerId: String(existing.id) })
    : await upsertMerchantTerminalReader({
        ...shared,
        // Server-fixed. An operator cannot register a simulated device, which is
        // what previously caused a locally created reader to be stored as
        // "ready" and read back as online.
        simulated: false,
      })

  const correlationId = randomUUID()
  logShift4Event("info", "shift4_retail_terminal_configured", {
    merchantId,
    channel: SHIFT4_TERMINAL_CHANNEL,
    environment,
    correlationId,
    terminalReaderId: String(reader.id),
    // The intent, not the identifiers: no terminal id, serial, or model is
    // logged.
    state: input.intent,
  })

  return projectView({
    reader,
    environment,
    connectivity: await resolveShift4TerminalConnectivity(merchantId),
    evidenceSource: "none",
    lastVerifiedAt: null,
    correlationId,
  })
}

/**
 * Verify Shift4 terminal readiness.
 *
 * READ-ONLY in both directions: it writes nothing, and it sends nothing. There
 * is no documented Shift4 or Commerce Engine terminal-status operation in this
 * repository's sources, so PineTree checks the one thing it can actually
 * establish — whether its own required configuration is present — and labels the
 * result as exactly that.
 *
 * `connectivityState` therefore stays "unverified" and `providerCallPerformed`
 * stays false. Neither is a placeholder to be flipped optimistically: they
 * become meaningful only when `resolveShift4TerminalConnectivity` is given a
 * real, documented operation to call.
 */
export async function verifyShift4RetailTerminalReadiness(
  merchantId: string
): Promise<Shift4RetailTerminalVerification> {
  requireRestEnabled()
  const environment = requireEnvironment()
  const readers = await loadShift4Readers(merchantId)
  const reader = readers[0] ?? null

  const connectivity = await resolveShift4TerminalConnectivity(merchantId)
  const verifiedAt = new Date().toISOString()
  const correlationId = randomUUID()

  const view = projectView({
    reader,
    environment,
    connectivity,
    // The check inspected PineTree's own configuration. Naming the source this
    // precisely is what stops a local result from reading as provider evidence.
    evidenceSource: "pinetree_local_configuration",
    lastVerifiedAt: verifiedAt,
    correlationId,
  })

  const flags = readShift4FeatureFlags()

  logShift4Event("info", "shift4_retail_terminal_readiness_checked", {
    merchantId,
    channel: SHIFT4_TERMINAL_CHANNEL,
    environment,
    correlationId,
    readinessState: view.readinessState,
    evidenceSource: view.evidenceSource,
    verifiedAt,
  })

  // Rebuilt field by field rather than spread. Nothing here originates from a
  // database row, and keeping the assignment explicit means a column or view
  // field added later cannot reach an API response by accident.
  return Object.freeze({
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
    providerCallPerformed: false,
    awaiting: Object.freeze(
      [
        reader ? null : "pinetree_terminal_configuration",
        "shift4_device_assignment",
        "shift4_terminal_status_operation_documentation",
        flags.commerceEngineConfigured ? null : "commerce_engine_configuration",
        "shift4_certification",
      ].filter((item): item is string => item !== null)
    ),
    proves: reader ? "local_terminal_configuration_present" : "no_local_terminal_configuration",
    doesNotProve: [
      "provider_connectivity",
      "terminal_activation",
      "certification",
      "card_processing_approval",
    ] as const,
  })
}
