/**
 * PineTree Engine - Shift4 REST merchant connection service.
 *
 * Owns the credential lifecycle that the provider adapter must not own:
 *   1. guard against concurrent and duplicate access-token exchanges;
 *   2. call the Shift4 adapter to perform the exchange;
 *   3. encrypt the resulting access token;
 *   4. persist it through the existing merchant_providers connection record;
 *   5. return a non-secret, auditable connection result.
 *
 * Architecture: UI -> API -> ENGINE (here) -> PROVIDER -> Shift4. The provider
 * adapter never touches the database and this module never speaks HTTP to
 * Shift4 directly.
 *
 * ── Auth token discipline ────────────────────────────────────────────────────
 * The auth token is a parameter only. It is never stored, never logged, never
 * returned, and never written to an idempotency record. Its SHA-256 hash is used
 * as the duplicate-exchange key, which detects replay of the same single-use
 * production token without retaining the token itself.
 */

import { createHash, randomUUID } from "node:crypto"

import {
  claimApiIdempotency,
  completeApiIdempotencyClaim,
  releaseApiIdempotencyClaim,
} from "@/database/apiIdempotencyClaims"
import {
  clearShift4RestCredential,
  getShift4RestConnectionStatus,
  isShift4RestConnectionChannel,
  saveShift4RestConnection,
  type Shift4RestConnectionChannel,
  type Shift4RestConnectionStatusView,
} from "@/database/merchantShift4RestConnections"
import { getShift4RestConfig } from "@/providers/shift4/rest/config"
import { exchangeAccessToken } from "@/providers/shift4/rest/credentials/exchangeAccessToken"
import { encryptShift4AccessToken } from "@/providers/shift4/rest/credentials/secretEnvelope"
import { describeShift4Error, Shift4RestApiError } from "@/providers/shift4/rest/errors"

/** Route key for the shared api_idempotency_claims guard. */
const SHIFT4_EXCHANGE_ROUTE = "engine.shift4.access_token_exchange"

/** How long a claim is retained before cleanup may remove it. */
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000

export class Shift4ConnectionError extends Error {
  readonly code:
    | "exchange_in_progress"
    | "auth_token_already_used"
    | "exchange_failed"
    | "invalid_channel"
    | "not_configured"

  /**
   * Shift4's own short error text, when it supplied one. Safe to show an
   * authenticated operator: `shortText` is a documented non-secret field and the
   * auth token is never part of it.
   */
  readonly providerShortText: string | null

  constructor(
    message: string,
    code: Shift4ConnectionError["code"],
    providerShortText: string | null = null
  ) {
    super(message)
    this.name = "Shift4ConnectionError"
    this.code = code
    this.providerShortText = providerShortText
  }
}

export type ConnectShift4MerchantResult = {
  connectionId: string
  /** True when this call performed the exchange; false when it replayed one. */
  exchanged: boolean
  environment: string
  channel: Shift4RestConnectionChannel
  accessTokenFingerprint: string
  correlationId: string
  connectedAt: string
  serverName: string | null
}

function hashAuthToken(authToken: string): string {
  return createHash("sha256").update(String(authToken)).digest("hex")
}

/**
 * Exchange a merchant Auth Token for a Shift4 Access Token and store it.
 *
 * The CHANNEL is required. Shift4 scopes an access token to one merchant
 * account and interface, so Retail and E-commerce each need their own
 * exchange, and the resulting credentials are stored under separate keys in one
 * `shift4_rest` row. Passing the channel explicitly is what makes it impossible
 * for one channel's exchange to overwrite the other's credential.
 *
 * Concurrency and duplication are guarded by the existing
 * `api_idempotency_claims` table, whose unique constraint makes the claim
 * atomic across serverless instances:
 *   - a second concurrent call for the same auth token loses the race and is
 *     rejected with `exchange_in_progress`;
 *   - a later call reusing an auth token that already succeeded is rejected with
 *     `auth_token_already_used`, matching Shift4's single-use production rule.
 *     The claim key is the auth-token hash alone, deliberately not the channel,
 *     so a token spent on Retail cannot be replayed against E-commerce;
 *   - a failed exchange releases its claim so the merchant can retry with the
 *     new auth token their Account Administrator issues.
 */
export async function connectShift4Merchant(input: {
  merchantId: string
  authToken: string
  channel: Shift4RestConnectionChannel
  merchantTimeZone?: string
}): Promise<ConnectShift4MerchantResult> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Shift4ConnectionError("A merchant is required to connect Shift4.", "exchange_failed")
  }

  const authToken = String(input.authToken || "").trim()
  if (!authToken) {
    throw new Shift4ConnectionError(
      "A Shift4 auth token is required to connect this merchant.",
      "exchange_failed"
    )
  }

  const channel = input.channel
  if (!isShift4RestConnectionChannel(channel)) {
    throw new Shift4ConnectionError(
      "A Shift4 channel of \"retail\" or \"ecommerce\" is required. There is no shared connection.",
      "invalid_channel"
    )
  }

  let config: ReturnType<typeof getShift4RestConfig>
  try {
    config = getShift4RestConfig()
  } catch (error) {
    // A misconfigured deployment is a distinct, actionable condition - not an
    // exchange failure that would suggest retrying with a new auth token.
    throw new Shift4ConnectionError(
      error instanceof Error ? error.message : "Shift4 REST is not configured.",
      "not_configured"
    )
  }

  const correlationId = randomUUID()
  const keyHash = hashAuthToken(authToken)
  const requestHash = createHash("sha256")
    .update(`${merchantId}|${channel}|${config.environment}|${config.identity.interfaceName}`)
    .digest("hex")

  const claim = await claimApiIdempotency({
    merchantId,
    route: SHIFT4_EXCHANGE_ROUTE,
    keyHash,
    requestHash,
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
  })

  if (!claim.claimed) {
    // A claim already exists for this auth token.
    if (claim.claim.resource_id) {
      throw new Shift4ConnectionError(
        "This Shift4 auth token has already been exchanged. Production auth tokens are single-use; ask the merchant's Lighthouse Transaction Manager Account Administrator for a new one.",
        "auth_token_already_used"
      )
    }
    throw new Shift4ConnectionError(
      "A Shift4 access token exchange is already in progress for this merchant.",
      "exchange_in_progress"
    )
  }

  try {
    const outcome = await exchangeAccessToken({
      authToken,
      merchantTimeZone: input.merchantTimeZone,
      config,
      context: { correlationId, merchantId },
    })

    const encryptedAccessToken = encryptShift4AccessToken(outcome.accessToken)

    const { connectionId } = await saveShift4RestConnection({
      merchantId,
      channel,
      encryptedAccessToken,
      accessTokenFingerprint: outcome.auditableResult.accessTokenFingerprint,
      environment: config.environment,
      interfaceName: outcome.auditableResult.interfaceName,
      interfaceVersion: outcome.auditableResult.interfaceVersion,
      companyName: outcome.auditableResult.companyName,
      correlationId: outcome.auditableResult.correlationId,
      serverName: outcome.auditableResult.serverName,
      providerDateTime: outcome.auditableResult.providerDateTime,
    })

    // The claim records only non-secret evidence.
    await completeApiIdempotencyClaim({
      claimId: claim.claim.id,
      resourceId: connectionId,
      responseBody: {
        environment: config.environment,
        channel,
        accessTokenFingerprint: outcome.auditableResult.accessTokenFingerprint,
        correlationId: outcome.auditableResult.correlationId,
        exchangedAt: outcome.auditableResult.exchangedAt,
        serverName: outcome.auditableResult.serverName,
      },
    })

    console.info("[shift4-connection] access_token_exchange_succeeded", {
      merchantId,
      connectionId,
      channel,
      environment: config.environment,
      correlationId: outcome.auditableResult.correlationId,
      accessTokenFingerprint: outcome.auditableResult.accessTokenFingerprint,
      serverName: outcome.auditableResult.serverName,
    })

    return {
      connectionId,
      exchanged: true,
      environment: config.environment,
      channel,
      accessTokenFingerprint: outcome.auditableResult.accessTokenFingerprint,
      correlationId: outcome.auditableResult.correlationId,
      connectedAt: outcome.auditableResult.exchangedAt,
      serverName: outcome.auditableResult.serverName,
    }
  } catch (error) {
    // Release the claim so a retry with a fresh auth token is not blocked by a
    // failure. `releaseApiIdempotencyClaim` only deletes unresolved claims, so a
    // successful exchange can never be released by a later error.
    await releaseApiIdempotencyClaim(claim.claim.id).catch((releaseError: unknown) => {
      // Not fatal: a genuine retry uses a NEW auth token, which hashes to a
      // different claim key and is therefore never blocked by this row.
      console.warn("[shift4-connection] claim_release_failed", {
        merchantId,
        channel,
        correlationId,
        reason: releaseError instanceof Error ? releaseError.message : "unknown",
      })
    })

    console.warn("[shift4-connection] access_token_exchange_failed", {
      merchantId,
      channel,
      environment: config.environment,
      correlationId,
      ...describeShift4Error(error),
    })

    if (error instanceof Shift4ConnectionError) throw error
    throw new Shift4ConnectionError(
      "Shift4 did not issue an access token for this merchant.",
      "exchange_failed",
      error instanceof Shift4RestApiError ? error.shortText : null
    )
  }
}

/** Non-secret connection status for API and admin surfaces. */
export async function getShift4MerchantConnection(
  merchantId: string
): Promise<Shift4RestConnectionStatusView | null> {
  return getShift4RestConnectionStatus(merchantId)
}

/**
 * Disconnect or mark revoked. Shift4 documents that an access token can be
 * revoked by the merchant's Account Administrator, after which a new Auth Token
 * is required, so `revoked` is a distinct outcome from a merchant disconnect.
 *
 * With `channel` omitted every stored credential is cleared. With a channel
 * supplied only that channel is cleared, so revoking Retail does not take
 * E-commerce offline.
 */
export async function disconnectShift4Merchant(
  merchantId: string,
  reason: "disconnected" | "revoked" = "disconnected",
  channel?: Shift4RestConnectionChannel
): Promise<void> {
  await clearShift4RestCredential(merchantId, reason, channel)
  console.info("[shift4-connection] credential_cleared", {
    merchantId,
    reason,
    channel: channel ?? "all",
  })
}
