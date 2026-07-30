/**
 * POST /credentials/accesstoken - Access Token Exchange.
 *
 * Exchanges the certified PineTree Client GUID plus a merchant-supplied Auth
 * Token for a merchant-scoped Access Token.
 *
 * Official request schema (required fields marked):
 *   {
 *     "dateTime": "<ISO 8601 with offset, merchant LOCAL time>",   *
 *     "credential": { "authToken": "...", "clientGuid": "..." }    *
 *   }
 * Required headers: InterfaceVersion, InterfaceName, CompanyName.
 * This endpoint is NOT authenticated by AccessToken - it produces one.
 *
 * Official 200 response:
 *   { "result": [ { "dateTime": "...",
 *                   "credential": { "accessToken": "..." },
 *                   "server": { "name": "..." } } ] }
 *
 * ── Auth token handling ──────────────────────────────────────────────────────
 * Shift4: "An Auth Token in production is valid only for a single Access Token
 * Exchange for a specific merchant account within a limited number of days ...
 * an Auth Token should never be stored by your application, and should be
 * immediately discarded after an Access Token has been acquired."
 *
 * This module therefore: accepts the auth token as an argument only, never
 * returns it, never logs it, never persists it, and holds no module-level
 * reference to it. The test auth token may be reused in the certification
 * environment; that is a Shift4-side property, so no code path depends on it.
 */

import { createHash } from "node:crypto"

import { formatShift4DateTime } from "../dateTime"

import {
  assertOpaqueCredential,
  getShift4ClientGuid,
  getShift4RestConfig,
  SHIFT4_FIELD_LIMITS,
  type Shift4RestConfig,
} from "../config"
import { shift4RestRequest, type Shift4RequestContext } from "../client"
import { Shift4RestApiError, Shift4RestInvalidResponseError } from "../errors"
import type {
  Shift4AccessTokenExchangeRequest,
  Shift4AccessTokenExchangeResult,
  Shift4Envelope,
} from "../types"

// Re-exported so the credentials entry point stays self-describing.
export { formatShift4DateTime }

export type ExchangeShift4AccessTokenInput = {
  /**
   * The merchant's Auth Token from their Lighthouse Transaction Manager Account
   * Administrator. Single-use in production. Never stored or logged.
   */
  authToken: string
  /** Merchant local time is required; defaults to now if not supplied. */
  requestedAt?: Date
  /**
   * The merchant's IANA time zone. Shift4 requires the LOCAL date/time of the
   * merchant with its UTC offset. When omitted the server's own offset is used,
   * which is correct only when the server and merchant share a time zone.
   */
  merchantTimeZone?: string
  context?: Shift4RequestContext
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
}

/**
 * The exchange result. Deliberately split so callers can log
 * `auditableResult` freely while `accessToken` stays confined to the Engine
 * path that immediately encrypts it.
 */
export type Shift4AccessTokenExchangeOutcome = {
  /** The merchant-scoped Shift4 access token. Never send this to a browser. */
  accessToken: string
  /** Non-secret evidence that the exchange happened and succeeded. */
  auditableResult: {
    exchangedAt: string
    providerDateTime: string | null
    serverName: string | null
    environment: Shift4RestConfig["environment"]
    interfaceName: string
    interfaceVersion: string
    companyName: string
    correlationId: string
    /** Fingerprint of the access token, for support without disclosure. */
    accessTokenFingerprint: string
  }
}

/**
 * A short, non-reversible fingerprint of an access token, so operators can
 * confirm which credential is installed without ever seeing it.
 */
export function shift4AccessTokenFingerprint(accessToken: string): string {
  // A truncated SHA-256 is enough to distinguish credentials and cannot be
  // reversed into the token.
  return createHash("sha256").update(String(accessToken)).digest("hex").slice(0, 12)
}

export function buildAccessTokenExchangeRequest(input: {
  authToken: string
  clientGuid: string
  dateTime: string
}): Shift4AccessTokenExchangeRequest {
  return {
    dateTime: input.dateTime,
    credential: {
      authToken: input.authToken,
      clientGuid: input.clientGuid,
    },
  }
}

/**
 * Perform the access-token exchange.
 *
 * Server-side only. Returns a normalized outcome; never returns or logs the
 * auth token, and never returns the access token to any browser-facing caller.
 */
export async function exchangeAccessToken(
  input: ExchangeShift4AccessTokenInput
): Promise<Shift4AccessTokenExchangeOutcome> {
  const config = input.config ?? getShift4RestConfig()
  const clientGuid = getShift4ClientGuid()

  const authToken = String(input.authToken || "").trim()
  if (!authToken) {
    throw new Shift4RestApiError("A Shift4 auth token is required to request an access token.", {
      diagnostics: { operation: "access_token_exchange" },
    })
  }
  assertOpaqueCredential(authToken, SHIFT4_FIELD_LIMITS.authToken, "Shift4 auth token")

  const requestedAt = input.requestedAt ?? new Date()
  const body = buildAccessTokenExchangeRequest({
    authToken,
    clientGuid,
    dateTime: formatShift4DateTime(requestedAt, input.merchantTimeZone),
  })

  // The access token must be read from the unredacted body - redaction blanks it
  // by design. The hook is the only sanctioned access, and the captured value
  // stays inside this function until the Engine encrypts it.
  let capturedAccessToken = ""
  const response = await shift4RestRequest({
    operation: "access_token_exchange",
    body,
    context: input.context,
    config,
    fetchImpl: input.fetchImpl,
    onParsedBody: (parsed) => {
      capturedAccessToken = readAccessTokenFromEnvelope(parsed)
    },
  })

  // A 400 carries a structured error in the same envelope. The client already
  // classified communication failures; anything else surfaces here.
  const structuredError = response.error
  if (structuredError) {
    throw new Shift4RestApiError("Shift4 rejected the access token exchange.", {
      code: structuredError.code ?? null,
      severity: structuredError.severity ?? null,
      shortText: structuredError.shortText ?? null,
      longText: structuredError.longText ?? null,
      primaryCode: structuredError.primaryCode ?? null,
      secondaryCode: structuredError.secondaryCode ?? null,
      diagnostics: {
        operation: "access_token_exchange",
        correlationId: response.result.correlationId,
        httpStatus: response.result.httpStatus,
        serverName: response.result.serverName,
      },
    })
  }

  const accessToken = capturedAccessToken
  if (!accessToken) {
    throw new Shift4RestInvalidResponseError(
      "Shift4 access token exchange succeeded but the response contained no credential.accessToken.",
      {
        operation: "access_token_exchange",
        correlationId: response.result.correlationId,
        httpStatus: response.result.httpStatus,
        serverName: response.result.serverName,
      }
    )
  }

  assertOpaqueCredential(accessToken, SHIFT4_FIELD_LIMITS.accessToken, "Shift4 access token")

  return {
    accessToken,
    auditableResult: {
      exchangedAt: response.result.requestCompletedAt,
      providerDateTime: response.result.providerDateTime,
      serverName: response.result.serverName,
      environment: config.environment,
      interfaceName: config.identity.interfaceName,
      interfaceVersion: config.identity.interfaceVersion,
      companyName: config.identity.companyName,
      correlationId: response.result.correlationId,
      accessTokenFingerprint: shift4AccessTokenFingerprint(accessToken),
    },
  }
}

function readAccessTokenFromEnvelope(body: unknown): string {
  if (!body || typeof body !== "object") return ""
  const envelope = body as Shift4Envelope<Shift4AccessTokenExchangeResult>
  if (!Array.isArray(envelope.result) || envelope.result.length === 0) return ""
  return String(envelope.result[0]?.credential?.accessToken || "").trim()
}
