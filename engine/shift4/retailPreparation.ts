/**
 * Shift4 Retail card-payment preparation — the boundary the POS reaches today.
 *
 * The POS selects a PineTree reader; this module turns that selection into a
 * validated, ready-to-send Commerce Engine For Cloud plan and then STOPS at the
 * feature gate. Nothing here dispatches, and nothing here writes a payment,
 * attempt, or ledger entry.
 *
 * ── One correction to a common assumption ────────────────────────────────────
 * A Commerce Engine For Cloud request does NOT carry a Shift4 terminal ID. The
 * published `device` object is `{ cloud, manufacturer, serialNumber }` — the
 * device is addressed by MANUFACTURER AND SERIAL NUMBER. PineTree's stored
 * `provider_reader_id` (the Shift4 terminal ID) remains the Shift4-side
 * merchant/terminal binding and PineTree's own evidence key, but it is not a
 * field in the request body, so this module does not invent a place to put it.
 *
 * ── What the browser may send ────────────────────────────────────────────────
 * One PineTree reader ID, and only one already listed for its own merchant.
 * Merchant identity, provider, environment, channel, the Shift4 terminal ID,
 * the serial number and the manufacturer are all resolved here, server-side.
 * A raw Shift4 terminal ID submitted by a browser cannot match a PineTree row
 * id and is rejected as an unknown reader.
 *
 * ── No cardholder data ───────────────────────────────────────────────────────
 * There is no PAN, expiry, CSC, track, PIN, PIN block, KSN or P2PE field in any
 * type in this module or in the Cloud request it plans. The card is read at the
 * device.
 */

import { getShift4RestAccessToken } from "@/database/merchantShift4RestConnections"
import { classifyShift4Device, shift4RoutingFor } from "@/providers/shift4/commerce-engine/cloud"
import { getShift4RestConfig, type Shift4RestEnvironment } from "@/providers/shift4/rest/config"

import { resolveShift4CloudDevice, SHIFT4_PROVIDER_KEY } from "./deviceStatus"
import { readShift4FeatureFlags } from "./readiness"
import { readShift4ReaderConnectivity } from "./terminalReadiness"

/** The safe reason a blocked preparation reports. Never a provider error. */
export const SHIFT4_AWAITING_RETAIL_ENABLEMENT = "Awaiting Retail test enablement" as const

export class Shift4RetailPreparationError extends Error {
  readonly code:
    | "rest_disabled"
    | "reader_unavailable"
    | "reader_not_ready"
    | "connection_unavailable"
    | "environment_not_permitted"

  constructor(message: string, code: Shift4RetailPreparationError["code"]) {
    super(message)
    this.name = "Shift4RetailPreparationError"
    this.code = code
  }
}

/**
 * The validated plan for the request PineTree WILL send once gates open.
 *
 * `serialNumber` is deliberately absent: the plan proves a serial resolved
 * without handing one back to a caller. Only the masked form travels.
 */
export type Shift4RetailPreparationPlan = Readonly<{
  readerId: string
  label: string | null
  model: string | null
  maskedSerial: string | null
  manufacturer: string
  deviceClassification: string
  /** Endpoint and integration method for the operation PineTree would send. */
  operation: "sale" | "authorization"
  endpoint: string
  integrationMethod: "commerce_engine_cloud"
  environment: Shift4RestEnvironment
  channel: "retail"
  /**
   * Documented-required fields PineTree cannot supply until a real payment
   * exists (the invoice) or until Shift4 clarifies (`transaction.purchaseCard`).
   */
  pendingRequiredFields: readonly string[]
}>

export type Shift4RetailPreparation = Readonly<{
  /** True only when a real provider dispatch would be permitted. Never true yet. */
  dispatchPermitted: boolean
  /** Why dispatch is blocked. Safe, specific, and never a provider message. */
  blockedReason: string
  plan: Shift4RetailPreparationPlan
  providerCallPerformed: false
}>

/** Local status strings that mean "do not use this device", regardless of gates. */
const LOCALLY_DISABLED_STATUSES = new Set(["disabled", "inactive", "retired", "removed"])

/**
 * Validate a POS reader selection all the way to a sendable Cloud plan.
 *
 * Every check runs server-side against the merchant derived from the signed
 * terminal session. A reader belonging to another merchant fails exactly like a
 * reader that does not exist, so the caller learns nothing either way.
 */
export async function prepareShift4RetailCardPayment(input: {
  merchantId: string
  readerId: string
  operation?: "sale" | "authorization"
}): Promise<Shift4RetailPreparation> {
  const flags = readShift4FeatureFlags()
  if (!flags.restApi) {
    throw new Shift4RetailPreparationError(
      "The Shift4 REST integration is disabled for this deployment.",
      "rest_disabled"
    )
  }

  // Ownership, provider, simulation, serial number and manufacturer are all
  // revalidated here — the POS's earlier selection is not trusted as proof.
  let resolved
  try {
    resolved = await resolveShift4CloudDevice(input.merchantId, input.readerId)
  } catch {
    // Deliberately generic and identical for every rejection reason.
    throw new Shift4RetailPreparationError(
      "Shift4 Retail reader is unavailable",
      "reader_unavailable"
    )
  }
  const { reader, manufacturer } = resolved

  if (LOCALLY_DISABLED_STATUSES.has(String(reader.status ?? "").trim().toLowerCase())) {
    throw new Shift4RetailPreparationError(
      "This terminal is disabled in PineTree.",
      "reader_not_ready"
    )
  }

  // A device Shift4 has told us is unregistered or offline must not be planned
  // against, even while the gate would block dispatch anyway. Stale evidence has
  // already been downgraded and does not block.
  const connectivity = readShift4ReaderConnectivity(reader)
  if (connectivity.state === "unregistered" || connectivity.state === "offline") {
    throw new Shift4RetailPreparationError(
      "Shift4 reports this terminal is not available.",
      "reader_not_ready"
    )
  }

  const environment = getShift4RestConfig().environment
  if (environment !== "test" && !flags.production) {
    // Certification work happens in test. Planning against production while
    // production is not explicitly enabled would aim the eventual request at
    // the live host.
    throw new Shift4RetailPreparationError(
      "Retail preparation is restricted to the Shift4 test environment.",
      "environment_not_permitted"
    )
  }

  // The Retail credential must belong to THIS merchant. Resolving it here also
  // proves a usable credential exists before the POS shows a ready state.
  const connection = await getShift4RestAccessToken(input.merchantId, {
    channel: "retail",
    allowLegacySharedCredential: false,
  })
  if (!connection) {
    throw new Shift4RetailPreparationError(
      "No stored Shift4 Retail credential is available for this merchant.",
      "connection_unavailable"
    )
  }

  const operation = input.operation ?? "sale"
  const routing = shift4RoutingFor(operation)
  const classification = classifyShift4Device(reader.device_type)

  const plan: Shift4RetailPreparationPlan = Object.freeze({
    readerId: reader.id,
    label: reader.label ?? null,
    model: reader.device_type ?? null,
    maskedSerial: maskSerial(reader.serial_number),
    manufacturer,
    deviceClassification: classification.classification,
    operation,
    endpoint: routing?.endpoint ?? `/transactions/${operation}`,
    integrationMethod: "commerce_engine_cloud" as const,
    environment,
    channel: "retail" as const,
    pendingRequiredFields: Object.freeze([
      // Derived from a real PineTree payment attempt; none exists in a dry run.
      "transaction.invoice",
      // Documented as required while the spec's own retail example omits it.
      "transaction.purchaseCard",
    ]),
  })

  // Every gate that would permit a real dispatch is still closed, and this is
  // the single place that says so.
  const blockedReason = !flags.retail
    ? SHIFT4_AWAITING_RETAIL_ENABLEMENT
    : !flags.certificationMode
      ? "Awaiting Shift4 certification mode"
      : !flags.commerceEngineConfigured
        ? "Awaiting Commerce Engine provisioning"
        : "Awaiting physical terminal verification"

  return Object.freeze({
    dispatchPermitted: false,
    blockedReason,
    plan,
    providerCallPerformed: false as const,
  })
}

function maskSerial(serial: string | null | undefined): string | null {
  const value = String(serial ?? "").trim()
  if (!value) return null
  if (value.length <= 4) return "*".repeat(value.length)
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`
}

export { SHIFT4_PROVIDER_KEY }
