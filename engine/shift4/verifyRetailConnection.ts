/**
 * PineTree Engine — read-only verification of the stored Shift4 RETAIL credential.
 *
 * Answers exactly one question for the sandbox operator: does the Retail access
 * token PineTree already holds still authenticate against the configured Shift4
 * environment?
 *
 * Layering: Admin UI -> authenticated PineTree API -> THIS Engine module ->
 * Shift4 REST adapter -> Shift4 test API. This module performs no HTTP call of
 * its own and writes nothing.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────────
 *  - It performs no Access Token Exchange. The stored credential is read and
 *    reused; it is never replaced, refreshed, or cleared.
 *  - It creates no transaction. `merchant_information` is a documented
 *    read-only lookup (GET /merchants/merchant) listed in
 *    SHIFT4_IDEMPOTENT_LOOKUP_OPERATIONS, and no authorization, sale, capture,
 *    refund or void is reachable from here.
 *  - It enables nothing. No feature flag is written, no capability is granted,
 *    and card processing stays disabled while SHIFT4_RETAIL_ENABLED is absent
 *    or false.
 *  - It never retries. One request per operator click, whatever the outcome.
 *
 * ── Readiness semantics ──────────────────────────────────────────────────────
 * A success proves ONE thing: the stored Retail authentication is usable right
 * now. It is not certification, terminal readiness, card-processing approval or
 * production eligibility, and it must never be used to set
 * `card_processing_verified`. The returned `proves`/`doesNotProve` fields state
 * that explicitly so a caller cannot quietly widen the claim.
 *
 * ── Disclosure ───────────────────────────────────────────────────────────────
 * The access token is decrypted inside this function, handed straight to the
 * adapter, and never returned, logged, or attached to an error. The result is
 * assembled field by field from non-secret values only.
 */

import { randomUUID } from "node:crypto"

import {
  getShift4RestAccessToken,
  Shift4CredentialEnvironmentMismatchError,
} from "@/database/merchantShift4RestConnections"
import { getMerchantInformation } from "@/providers/shift4/rest"
import { getShift4RestConfig, type Shift4RestEnvironment } from "@/providers/shift4/rest/config"

import { logShift4Event } from "./observability"
import { readShift4FeatureFlags } from "./readiness"

/**
 * The only channel this module can verify. A module constant, not a parameter,
 * so no caller — route, test, or future Engine module — can aim it at
 * E-commerce.
 */
export const SHIFT4_VERIFICATION_CHANNEL = "retail" as const

/** The documented read-only operation this verification performs. */
export const SHIFT4_VERIFICATION_OPERATION = "merchant_information" as const

export type Shift4RetailVerification = {
  connectionId: string
  environment: Shift4RestEnvironment
  channel: typeof SHIFT4_VERIFICATION_CHANNEL
  /** Which stored credential answered: the Retail channel's own, or a legacy one. */
  credentialSource: "channel" | "legacy_shared"
  operation: typeof SHIFT4_VERIFICATION_OPERATION
  /** Documented `server.name` from the Shift4 response. */
  serverName: string | null
  /** Documented `dateTime` from the Shift4 response. */
  providerDateTime: string | null
  /** PineTree's own completion timestamp. */
  verifiedAt: string
  correlationId: string
  /** Narrow, explicit statement of what this result does and does not establish. */
  proves: "stored_retail_authentication_usable"
  doesNotProve: readonly [
    "certification",
    "terminal_readiness",
    "card_processing_approval",
    "production_eligibility",
  ]
  /**
   * PineTree-side capability indicators, read from deployment configuration.
   * They describe what PineTree currently permits, NOT anything Shift4 returned
   * — the Merchant Information response is not documented to carry capability
   * data, and none is invented here.
   */
  capabilities: {
    restApiEnabled: boolean
    retailProcessingEnabled: boolean
  }
}

/** Errors an operator interface may act on, without provider detail. */
export class Shift4RetailVerificationError extends Error {
  readonly code:
    | "rest_disabled"
    | "connection_unavailable"
    | "environment_mismatch"
    | "not_configured"
    | "verification_failed"

  constructor(message: string, code: Shift4RetailVerificationError["code"]) {
    super(message)
    this.name = "Shift4RetailVerificationError"
    this.code = code
  }
}

/**
 * Verify the stored Retail credential for one merchant.
 *
 * `merchantId` is supplied by the route from the authenticated operator session
 * and is the only input; channel and environment are decided here.
 */
export async function verifyShift4RetailConnection(
  merchantId: string
): Promise<Shift4RetailVerification> {
  const flags = readShift4FeatureFlags()
  if (!flags.restApi) {
    // The deployment's own REST switch is off; no request may leave PineTree.
    throw new Shift4RetailVerificationError(
      "The Shift4 REST integration is disabled for this deployment.",
      "rest_disabled"
    )
  }

  // Environment is server configuration, never a caller input. Reading the
  // config here also validates the interface identity headers, so a
  // misconfigured deployment fails before a request is built.
  let environment: Shift4RestEnvironment
  try {
    environment = getShift4RestConfig().environment
  } catch {
    // Config errors name environment variables; the operator message does not.
    throw new Shift4RetailVerificationError(
      "The Shift4 REST integration is not fully configured.",
      "not_configured"
    )
  }

  let connection: Awaited<ReturnType<typeof getShift4RestAccessToken>>
  try {
    connection = await getShift4RestAccessToken(merchantId, {
      channel: SHIFT4_VERIFICATION_CHANNEL,
      // Deliberately NOT enabled. The point of this action is to prove the
      // RETAIL credential works; answering with a pre-channel legacy token
      // would prove something else while reporting Retail success. The
      // documented compatibility path stays available to the certification
      // service, which needs it for a different question.
      allowLegacySharedCredential: false,
    })
  } catch (error) {
    if (error instanceof Shift4CredentialEnvironmentMismatchError) {
      // The stored credential belongs to a different Shift4 environment. Fail
      // closed rather than authenticate against the wrong host.
      throw new Shift4RetailVerificationError(
        "The stored Retail credential belongs to a different Shift4 environment.",
        "environment_mismatch"
      )
    }
    throw error
  }

  if (!connection) {
    throw new Shift4RetailVerificationError(
      "No stored Shift4 Retail credential is available for this merchant.",
      "connection_unavailable"
    )
  }

  const correlationId = randomUUID()

  // The decrypted token exists only as this argument. It is not held in a
  // local, not logged, and not part of any value this function returns.
  const information = await getMerchantInformation({
    accessToken: connection.accessToken,
    // The operator explicitly requested this backend-only lookup; the flag is
    // the adapter's guard against incidental use, not a certification claim.
    certificationScopeConfirmed: true,
    context: {
      correlationId,
      merchantId,
      merchantProviderConnectionId: connection.connectionId,
    },
  })

  // For a read-only lookup, "approved" means Shift4 answered with the
  // documented envelope and no error object. Anything else is not a usable
  // credential and must not be reported as one.
  if (information.outcome !== "approved") {
    throw new Shift4RetailVerificationError(
      "Shift4 did not confirm the stored Retail credential.",
      "verification_failed"
    )
  }

  const verifiedAt = new Date().toISOString()

  // One safe structured success event. Every field is non-secret and every key
  // is on the Shift4 log allowlist.
  logShift4Event("info", "shift4_retail_connection_verified", {
    merchantId,
    connectionId: connection.connectionId,
    environment,
    channel: SHIFT4_VERIFICATION_CHANNEL,
    correlationId,
    serverName: information.serverName,
    verifiedAt,
  })

  return {
    connectionId: connection.connectionId,
    environment,
    channel: SHIFT4_VERIFICATION_CHANNEL,
    credentialSource: connection.source,
    operation: SHIFT4_VERIFICATION_OPERATION,
    serverName: information.serverName,
    providerDateTime: information.providerDateTime,
    verifiedAt,
    correlationId,
    proves: "stored_retail_authentication_usable",
    doesNotProve: [
      "certification",
      "terminal_readiness",
      "card_processing_approval",
      "production_eligibility",
    ],
    capabilities: {
      restApiEnabled: flags.restApi,
      // Reported, never set. A successful read-only verification does not turn
      // Retail processing on and does not mark card processing certified.
      retailProcessingEnabled: flags.retail,
    },
  }
}
