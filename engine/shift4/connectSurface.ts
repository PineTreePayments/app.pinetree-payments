/**
 * PineTree Engine - the Shift4 Retail sandbox connect surface.
 *
 * Answers one question for the authenticated merchant Providers page: may this
 * merchant perform a Retail sandbox Access Token Exchange right now, and what
 * is already connected?
 *
 * ── What this deliberately does NOT do ───────────────────────────────────────
 * It performs no exchange, enables no processing capability, and reads no
 * feature gate other than `SHIFT4_REST_ENABLED`. Establishing encrypted
 * authentication is not boarding, certification, or permission to take a
 * payment.
 *
 * ── Environment disclosure ───────────────────────────────────────────────────
 * The browser receives a single boolean plus a coarse reason code. No
 * environment variable NAME or VALUE crosses the boundary: `enabled` is true
 * only when the deployment is fully configured AND targeting the Shift4 test
 * host, which is the only fact the operator interface needs.
 */

import { getMerchantSettings } from "@/database/merchants"
import {
  getShift4RestConnectionStatus,
  type Shift4RestConnectionStatusView,
} from "@/database/merchantShift4RestConnections"
import { getShift4RestConfig } from "@/providers/shift4/rest/config"

import { readShift4FeatureFlags } from "./readiness"

/**
 * Why the connect interface is unavailable. Coarse by design: enough for an
 * operator to know who to ask, never enough to disclose configuration.
 */
export type Shift4ConnectDisabledReason =
  | "rest_disabled"
  | "not_test_environment"
  | "not_configured"

export type Shift4RetailConnectSurface = {
  /** The single environment-derived fact the browser is allowed to know. */
  enabled: boolean
  disabledReason: Shift4ConnectDisabledReason | null
  /** The merchant's configured IANA time zone, from merchant settings. */
  merchantTimeZone: string | null
  merchantTimeZoneValid: boolean
  /** Safe status of the Retail channel; null when never connected. */
  retail: {
    connected: boolean
    accessTokenFingerprint: string | null
    connectedAt: string | null
    lastExchangeCorrelationId: string | null
  } | null
  /**
   * Display-only. This interface never modifies E-commerce; the flag exists so
   * the operator can see that a Retail exchange leaves it alone.
   */
  ecommerceConnected: boolean
  /** True when a pre-channel credential is still stored for this merchant. */
  legacySharedCredentialPresent: boolean
}

/**
 * True when the runtime recognizes the string as an IANA time zone.
 *
 * `Intl.DateTimeFormat` throws a RangeError for an unknown zone, which is the
 * only check that stays correct as the tz database is updated. Shared with the
 * connect route so the browser and the server apply one rule.
 */
export function isValidIanaTimeZone(value: string): boolean {
  const candidate = String(value || "").trim()
  if (!candidate) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve whether the deployment permits a Retail SANDBOX exchange.
 *
 * Fails closed on every uncertainty: a missing REST gate, a non-test
 * environment, or configuration that `getShift4RestConfig` refuses.
 */
function resolveAvailability(): { enabled: boolean; reason: Shift4ConnectDisabledReason | null } {
  if (!readShift4FeatureFlags().restApi) {
    return { enabled: false, reason: "rest_disabled" }
  }
  try {
    // Also validates the interface identity headers, so the interface renders
    // only when the exchange could actually succeed.
    if (getShift4RestConfig().environment !== "test") {
      return { enabled: false, reason: "not_test_environment" }
    }
  } catch {
    // Config errors name environment variables; the reason code does not.
    return { enabled: false, reason: "not_configured" }
  }
  return { enabled: true, reason: null }
}

/** The merchant's configured time zone. Never falls back to server or browser. */
async function readMerchantTimeZone(merchantId: string): Promise<string | null> {
  const settings = await getMerchantSettings(merchantId).catch(() => null)
  const configured = String(settings?.timezone || "").trim()
  return configured || null
}

function toRetailView(
  connection: Shift4RestConnectionStatusView | null
): Shift4RetailConnectSurface["retail"] {
  const retail = connection?.channels?.retail
  if (!retail) return null
  return {
    connected: retail.accessTokenPresent,
    accessTokenFingerprint: retail.accessTokenFingerprint,
    connectedAt: retail.connectedAt,
    lastExchangeCorrelationId: retail.lastExchangeCorrelationId,
  }
}

/**
 * Build the operator-interface descriptor for one authenticated merchant.
 *
 * Every field is non-secret: fingerprints, timestamps, correlation IDs, and
 * booleans only. No access token, auth token, client GUID, encrypted envelope,
 * or environment variable is reachable from the result.
 */
export async function getShift4RetailConnectSurface(
  merchantId: string
): Promise<Shift4RetailConnectSurface> {
  const availability = resolveAvailability()

  const [merchantTimeZone, connection] = await Promise.all([
    readMerchantTimeZone(merchantId),
    getShift4RestConnectionStatus(merchantId).catch(() => null),
  ])

  return {
    enabled: availability.enabled,
    disabledReason: availability.reason,
    merchantTimeZone,
    merchantTimeZoneValid: merchantTimeZone !== null && isValidIanaTimeZone(merchantTimeZone),
    retail: toRetailView(connection),
    ecommerceConnected: connection?.channels?.ecommerce?.accessTokenPresent === true,
    legacySharedCredentialPresent: connection?.legacySharedCredentialPresent === true,
  }
}
