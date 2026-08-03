/**
 * Persistence for the merchant's Shift4 Payment Platform REST connection.
 *
 * ── Why a separate provider key ──────────────────────────────────────────────
 * The connection is stored in the EXISTING `merchant_providers` table (one row
 * per merchant per provider, service-role-only RLS, credentials JSONB) under the
 * provider key `shift4_rest`. No migration is required.
 *
 * It deliberately does NOT reuse the legacy `shift4` row. That row drives
 * `providers/cardProviderReadiness.ts`, where a status of "active" or
 * "connected" makes a merchant appear ready to take card payments. Writing a
 * REST credential into it would silently flip existing production readiness
 * before any payment path is built - a behavior change well outside this phase.
 * `shift4_rest` is also not a routable adapter id (`normalizePaymentAdapter`
 * returns undefined for it), so the row cannot leak into payment routing or
 * available-network selection.
 *
 * ── One row, two channels ────────────────────────────────────────────────────
 * Shift4 scopes an access token to one merchant account AND one interface, so
 * Retail (Commerce Engine for Cloud + PAX) and E-commerce (i4Go) each require
 * their own Access Token Exchange. The row remains one per merchant: the
 * credentials JSONB holds a VERSIONED CHANNEL MAP, so both encrypted tokens
 * coexist and neither exchange can overwrite the other.
 *
 *   { provider_model, credential_version: 2,
 *     channels: { retail?: <credential>, ecommerce?: <credential> },
 *     legacy_shared?: <credential> }
 *
 * There are deliberately no `shift4_rest_retail` / `shift4_rest_ecommerce`
 * provider keys: a second row would duplicate tenancy and readiness state.
 *
 * ── Secret handling ──────────────────────────────────────────────────────────
 * Only the ENCRYPTED access-token envelope is stored, inside the credentials
 * JSONB. No plaintext credential column is created and no auth token is ever
 * persisted. The decrypted token is returned exclusively by
 * `getShift4RestAccessToken`, which is server-only and must never be called from
 * a route that serializes its result.
 */

import {
  decryptShift4AccessToken,
  isShift4EncryptedSecret,
  type Shift4EncryptedSecret,
} from "@/providers/shift4/rest/credentials/secretEnvelope"
import {
  getShift4RestConfig,
  type Shift4RestEnvironment,
} from "@/providers/shift4/rest/config"

import { supabaseAdmin } from "./supabase"

/**
 * Service-role access only.
 *
 * `merchant_providers` revokes all access from `anon` and `authenticated`, so
 * the anon client cannot read this table at all. Other modules fall back to it
 * (`supabaseAdmin || supabase`) because their failure mode is a harmless empty
 * read; here the row holds an encrypted credential, so the fallback is refused
 * outright rather than producing a confusing RLS error at call time.
 */
function serviceRoleDb() {
  if (!supabaseAdmin) {
    throw new Error(
      "The Shift4 REST connection requires service-role database access (SUPABASE_SERVICE_ROLE_KEY)."
    )
  }
  return supabaseAdmin
}

/** Provider key for the Shift4 REST connection row in merchant_providers. */
export const SHIFT4_REST_PROVIDER_NAME = "shift4_rest"

/** Current credentials-document version. Version 1 is the pre-channel shape. */
export const SHIFT4_REST_CREDENTIAL_VERSION = 2 as const

/**
 * A channel that an Access Token Exchange may be performed for.
 *
 * `shared` is NOT a member: it only ever existed as the version-1 default and
 * cannot be written by any current code path.
 */
export type Shift4RestConnectionChannel = "retail" | "ecommerce"

export const SHIFT4_REST_CONNECTION_CHANNELS: readonly Shift4RestConnectionChannel[] = [
  "retail",
  "ecommerce",
]

export function isShift4RestConnectionChannel(value: unknown): value is Shift4RestConnectionChannel {
  return value === "retail" || value === "ecommerce"
}

/**
 * Channel values that may appear in a STORED document, including the legacy
 * `shared` value written before the channel map existed.
 */
export type Shift4RestChannel = Shift4RestConnectionChannel | "shared"

/** Connection status values written by the Engine. */
export type Shift4RestConnectionStatus = "connected" | "disconnected" | "revoked"

/**
 * One channel's credential. `access_token` holds the AES-256-GCM envelope,
 * never a plaintext token. Every other field is non-secret audit evidence.
 */
type Shift4RestChannelCredential = {
  environment: Shift4RestEnvironment
  access_token?: Shift4EncryptedSecret
  access_token_fingerprint?: string
  interface_name?: string
  interface_version?: string
  company_name?: string
  connected_at?: string
  last_exchange_correlation_id?: string
  last_exchange_server_name?: string | null
  last_exchange_provider_date_time?: string | null
  revoked_at?: string
  /**
   * A successful token exchange proves only that PineTree can authenticate as
   * this merchant. It does NOT prove the merchant account is boarded, that a PAX
   * device is activated, or that card processing may go live. Every write here
   * records `false`; only a later phase, with real payment evidence, may record
   * true. Typed as boolean rather than the `false` literal because the column is
   * JSONB and reads must reflect what is actually stored.
   */
  card_processing_verified: boolean
}

/** The version-2 credentials JSONB document. */
type Shift4RestCredentialsV2 = {
  provider_model: "shift4_payment_platform_rest"
  credential_version: typeof SHIFT4_REST_CREDENTIAL_VERSION
  channels: Partial<Record<Shift4RestConnectionChannel, Shift4RestChannelCredential>>
  /**
   * A migrated version-1 document that was written before channels existed
   * (stored `channel: "shared"`). Readable ONLY through the explicit
   * `allowLegacySharedCredential` compatibility path - never as a silent
   * fallback for a channel that has no credential of its own.
   */
  legacy_shared?: Shift4RestChannelCredential
}

/** The version-1 credentials JSONB document, still readable. */
type Shift4RestCredentialsV1 = Shift4RestChannelCredential & {
  provider_model: "shift4_payment_platform_rest"
  channel?: Shift4RestChannel
}

/** Non-secret per-channel view. Safe to return from an API route. */
export type Shift4RestChannelStatusView = {
  accessTokenPresent: boolean
  accessTokenFingerprint: string | null
  environment: Shift4RestEnvironment | null
  interfaceName: string | null
  interfaceVersion: string | null
  companyName: string | null
  connectedAt: string | null
  lastExchangeCorrelationId: string | null
  lastExchangeServerName: string | null
  cardProcessingVerified: boolean
}

/** Non-secret view of the connection. Safe to return from an API route. */
export type Shift4RestConnectionStatusView = {
  connectionId: string
  status: string
  enabled: boolean
  connected: boolean
  environment: Shift4RestEnvironment | null
  accessTokenPresent: boolean
  accessTokenFingerprint: string | null
  interfaceName: string | null
  interfaceVersion: string | null
  companyName: string | null
  connectedAt: string | null
  lastExchangeCorrelationId: string | null
  lastExchangeServerName: string | null
  channel: Shift4RestChannel | null
  /** Per-channel detail; null when that channel has never been exchanged. */
  channels: Record<Shift4RestConnectionChannel, Shift4RestChannelStatusView | null>
  /** True when a pre-channel version-1 credential is still stored. */
  legacySharedCredentialPresent: boolean
  credentialVersion: number
  /** Always false until real payment evidence exists. Authentication is not boarding. */
  cardProcessingVerified: boolean
}

/**
 * Raised when a stored credential was minted for a different Shift4
 * environment than the one this deployment is currently configured for.
 *
 * Fails closed and LOUDLY rather than returning null: a test token must never
 * be sent to the production host, and a production token must never be sent to
 * the test host, and silently behaving as "not connected" would hide a
 * dangerous misconfiguration.
 */
export class Shift4CredentialEnvironmentMismatchError extends Error {
  readonly code = "credential_environment_mismatch"
  readonly status = 409
  readonly storedEnvironment: Shift4RestEnvironment
  readonly configuredEnvironment: Shift4RestEnvironment

  constructor(input: {
    storedEnvironment: Shift4RestEnvironment
    configuredEnvironment: Shift4RestEnvironment
    channel: Shift4RestConnectionChannel
  }) {
    super(
      `The stored Shift4 ${input.channel} credential was issued for the ${input.storedEnvironment} environment ` +
      `but this deployment is configured for ${input.configuredEnvironment}. ` +
      "Re-run the access token exchange for this environment."
    )
    this.name = "Shift4CredentialEnvironmentMismatchError"
    this.storedEnvironment = input.storedEnvironment
    this.configuredEnvironment = input.configuredEnvironment
  }
}

type ProviderRow = {
  id: string
  status: string | null
  enabled: boolean | null
  credentials: unknown
}

/** The normalized in-memory form of any stored credentials document. */
type NormalizedCredentialDocument = {
  credentialVersion: number
  channels: Partial<Record<Shift4RestConnectionChannel, Shift4RestChannelCredential>>
  legacyShared: Shift4RestChannelCredential | null
  /** The version-1 `channel` value, retained for the status view only. */
  storedChannelLabel: Shift4RestChannel | null
}

const EMPTY_DOCUMENT: NormalizedCredentialDocument = {
  credentialVersion: SHIFT4_REST_CREDENTIAL_VERSION,
  channels: {},
  legacyShared: null,
  storedChannelLabel: null,
}

/**
 * Read any stored credentials document into one normalized shape.
 *
 * Version 1 compatibility, without guessing:
 *   - `channel: "retail" | "ecommerce"` - the credential belongs to that
 *     channel and is presented as such;
 *   - `channel: "shared"` or absent - the credential predates the channel
 *     distinction, so it becomes `legacyShared` and is reachable only through
 *     the explicit compatibility path.
 */
function normalizeCredentialDocument(row: ProviderRow | null): NormalizedCredentialDocument {
  const raw = row?.credentials
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_DOCUMENT

  const document = raw as Partial<Shift4RestCredentialsV2> & Partial<Shift4RestCredentialsV1>

  if (Number(document.credential_version) === SHIFT4_REST_CREDENTIAL_VERSION) {
    const channels: NormalizedCredentialDocument["channels"] = {}
    const stored = document.channels
    if (stored && typeof stored === "object") {
      for (const channel of SHIFT4_REST_CONNECTION_CHANNELS) {
        const credential = stored[channel]
        if (credential && typeof credential === "object") channels[channel] = credential
      }
    }
    const legacyShared =
      document.legacy_shared && typeof document.legacy_shared === "object"
        ? document.legacy_shared
        : null
    return {
      credentialVersion: SHIFT4_REST_CREDENTIAL_VERSION,
      channels,
      legacyShared,
      storedChannelLabel: null,
    }
  }

  // ── Version 1 ────────────────────────────────────────────────────────────
  const legacy = document as Shift4RestCredentialsV1
  if (!legacy.environment) return EMPTY_DOCUMENT

  const credential: Shift4RestChannelCredential = {
    environment: legacy.environment,
    access_token: legacy.access_token,
    access_token_fingerprint: legacy.access_token_fingerprint,
    interface_name: legacy.interface_name,
    interface_version: legacy.interface_version,
    company_name: legacy.company_name,
    connected_at: legacy.connected_at,
    last_exchange_correlation_id: legacy.last_exchange_correlation_id,
    last_exchange_server_name: legacy.last_exchange_server_name,
    last_exchange_provider_date_time: legacy.last_exchange_provider_date_time,
    revoked_at: legacy.revoked_at,
    card_processing_verified: false,
  }

  const label = legacy.channel ?? "shared"
  if (isShift4RestConnectionChannel(label)) {
    return {
      credentialVersion: 1,
      channels: { [label]: credential },
      legacyShared: null,
      storedChannelLabel: label,
    }
  }

  return {
    credentialVersion: 1,
    channels: {},
    legacyShared: credential,
    storedChannelLabel: "shared",
  }
}

function toChannelStatusView(
  credential: Shift4RestChannelCredential | null
): Shift4RestChannelStatusView | null {
  if (!credential) return null
  return {
    accessTokenPresent: isShift4EncryptedSecret(credential.access_token),
    accessTokenFingerprint: credential.access_token_fingerprint ?? null,
    environment: credential.environment ?? null,
    interfaceName: credential.interface_name ?? null,
    interfaceVersion: credential.interface_version ?? null,
    companyName: credential.company_name ?? null,
    connectedAt: credential.connected_at ?? null,
    lastExchangeCorrelationId: credential.last_exchange_correlation_id ?? null,
    lastExchangeServerName: credential.last_exchange_server_name ?? null,
    cardProcessingVerified: credential.card_processing_verified === true,
  }
}

function toStatusView(row: ProviderRow): Shift4RestConnectionStatusView {
  const document = normalizeCredentialDocument(row)
  const retail = document.channels.retail ?? null
  const ecommerce = document.channels.ecommerce ?? null
  const legacy = document.legacyShared

  // The aggregate fields describe the connection as a whole and keep the
  // pre-channel view shape working. Per-channel truth lives in `channels`.
  const representative = retail ?? ecommerce ?? legacy
  const anyTokenPresent = [retail, ecommerce, legacy].some((credential) =>
    isShift4EncryptedSecret(credential?.access_token)
  )

  return {
    connectionId: String(row.id),
    status: String(row.status || ""),
    enabled: row.enabled === true,
    connected: String(row.status || "") === "connected" && anyTokenPresent,
    environment: representative?.environment ?? null,
    accessTokenPresent: anyTokenPresent,
    accessTokenFingerprint: representative?.access_token_fingerprint ?? null,
    interfaceName: representative?.interface_name ?? null,
    interfaceVersion: representative?.interface_version ?? null,
    companyName: representative?.company_name ?? null,
    connectedAt: representative?.connected_at ?? null,
    lastExchangeCorrelationId: representative?.last_exchange_correlation_id ?? null,
    lastExchangeServerName: representative?.last_exchange_server_name ?? null,
    channel: document.storedChannelLabel,
    channels: {
      retail: toChannelStatusView(retail),
      ecommerce: toChannelStatusView(ecommerce),
    },
    legacySharedCredentialPresent: isShift4EncryptedSecret(legacy?.access_token),
    credentialVersion: document.credentialVersion,
    cardProcessingVerified: [retail, ecommerce, legacy].some(
      (credential) => credential?.card_processing_verified === true
    ),
  }
}

async function loadRow(merchantId: string): Promise<ProviderRow | null> {
  const { data, error } = await serviceRoleDb()
    .from("merchant_providers")
    .select("id, status, enabled, credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", SHIFT4_REST_PROVIDER_NAME)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load the Shift4 REST connection: ${error.message}`)
  }
  return (data as ProviderRow | null) ?? null
}

/** Non-secret connection status, or null when the merchant has never connected. */
export async function getShift4RestConnectionStatus(
  merchantId: string
): Promise<Shift4RestConnectionStatusView | null> {
  const row = await loadRow(merchantId)
  return row ? toStatusView(row) : null
}

export type Shift4RestAccessTokenResolution = {
  connectionId: string
  environment: Shift4RestEnvironment
  channel: Shift4RestConnectionChannel
  /** Which stored credential answered: the channel's own, or the legacy one. */
  source: "channel" | "legacy_shared"
  accessToken: string
}

/**
 * Resolve the merchant's decrypted Shift4 access token FOR ONE CHANNEL.
 *
 * SERVER-ONLY. The return value is a live credential: pass it straight into the
 * Shift4 client and never place it in an API response, a log, an error, or a
 * database column.
 *
 * Fails closed:
 *   - the channel is required; there is no default and no inference;
 *   - a Retail request never resolves to the E-commerce credential, and the
 *     reverse is equally impossible - the two are read from separate keys;
 *   - a stored credential from a different Shift4 environment THROWS
 *     `Shift4CredentialEnvironmentMismatchError` rather than being used;
 *   - a missing or unreadable credential returns null.
 *
 * `allowLegacySharedCredential` is the explicit compatibility path for a
 * version-1 document written before channels existed. It defaults to false, so
 * new call sites must opt in deliberately and visibly.
 */
export async function getShift4RestAccessToken(
  merchantId: string,
  options: {
    channel: Shift4RestConnectionChannel
    allowLegacySharedCredential?: boolean
  }
): Promise<Shift4RestAccessTokenResolution | null> {
  if (!isShift4RestConnectionChannel(options?.channel)) {
    throw new Error(
      "A Shift4 channel (\"retail\" or \"ecommerce\") is required to resolve an access token."
    )
  }

  const row = await loadRow(merchantId)
  if (!row || String(row.status || "") !== "connected") return null

  const document = normalizeCredentialDocument(row)

  let credential = document.channels[options.channel] ?? null
  let source: Shift4RestAccessTokenResolution["source"] = "channel"

  if (!credential && options.allowLegacySharedCredential === true) {
    credential = document.legacyShared
    source = "legacy_shared"
  }

  if (!credential || !credential.environment) return null
  if (!isShift4EncryptedSecret(credential.access_token)) return null

  // ── Environment guard ───────────────────────────────────────────────────
  // Checked BEFORE decryption so a credential from the wrong environment is
  // never even materialized in memory.
  const configuredEnvironment = getShift4RestConfig().environment
  if (credential.environment !== configuredEnvironment) {
    throw new Shift4CredentialEnvironmentMismatchError({
      storedEnvironment: credential.environment,
      configuredEnvironment,
      channel: options.channel,
    })
  }

  return {
    connectionId: String(row.id),
    environment: credential.environment,
    channel: options.channel,
    source,
    accessToken: decryptShift4AccessToken(credential.access_token),
  }
}

/**
 * Persist one channel's encrypted access token and its non-secret evidence.
 *
 * Uses the existing unique (merchant_id, provider) relationship, so a repeated
 * exchange for the SAME channel replaces that channel's credential in place. A
 * different channel's credential is copied forward untouched, which is what
 * makes a Retail exchange unable to destroy an E-commerce token and vice versa.
 */
export async function saveShift4RestConnection(input: {
  merchantId: string
  channel: Shift4RestConnectionChannel
  encryptedAccessToken: Shift4EncryptedSecret
  accessTokenFingerprint: string
  environment: Shift4RestEnvironment
  interfaceName: string
  interfaceVersion: string
  companyName: string
  correlationId: string
  serverName: string | null
  providerDateTime: string | null
}): Promise<{ connectionId: string }> {
  if (!isShift4EncryptedSecret(input.encryptedAccessToken)) {
    throw new Error("Refusing to store a Shift4 access token that is not an encrypted envelope.")
  }

  if (!isShift4RestConnectionChannel(input.channel)) {
    throw new Error(
      "A Shift4 channel (\"retail\" or \"ecommerce\") is required to store a REST connection."
    )
  }

  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("A merchant is required to store a Shift4 REST connection.")
  }

  const now = new Date().toISOString()
  const credential: Shift4RestChannelCredential = {
    environment: input.environment,
    access_token: input.encryptedAccessToken,
    access_token_fingerprint: input.accessTokenFingerprint,
    interface_name: input.interfaceName,
    interface_version: input.interfaceVersion,
    company_name: input.companyName,
    connected_at: now,
    last_exchange_correlation_id: input.correlationId,
    last_exchange_server_name: input.serverName,
    last_exchange_provider_date_time: input.providerDateTime,
    card_processing_verified: false,
  }

  const existing = await loadRow(merchantId)
  const document = normalizeCredentialDocument(existing)

  // Copy the existing map forward, then overwrite only the requested channel.
  const credentials: Shift4RestCredentialsV2 = {
    provider_model: "shift4_payment_platform_rest",
    credential_version: SHIFT4_REST_CREDENTIAL_VERSION,
    channels: { ...document.channels, [input.channel]: credential },
  }
  if (document.legacyShared) {
    credentials.legacy_shared = document.legacyShared
  }

  if (existing?.id) {
    // Filtering on merchant_id as well as id is redundant today because
    // `existing` came from a merchant-scoped read, but it makes cross-tenant
    // overwrite impossible even if this function is later refactored to accept
    // a row id from elsewhere.
    const { error } = await serviceRoleDb()
      .from("merchant_providers")
      .update({ credentials, status: "connected", updated_at: now })
      .eq("id", existing.id)
      .eq("merchant_id", merchantId)
      .eq("provider", SHIFT4_REST_PROVIDER_NAME)

    if (error) {
      throw new Error(`Failed to save the Shift4 REST connection: ${error.message}`)
    }
    return { connectionId: String(existing.id) }
  }

  const { data: inserted, error } = await serviceRoleDb()
    .from("merchant_providers")
    .insert({
      merchant_id: merchantId,
      provider: SHIFT4_REST_PROVIDER_NAME,
      status: "connected",
      // The credential exists but no payment path is enabled yet, so the
      // connection stays disabled until its readiness gates allow it.
      enabled: false,
      credentials,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single()

  if (error || !inserted?.id) {
    throw new Error(`Failed to save the Shift4 REST connection: ${error?.message || "unknown error"}`)
  }

  return { connectionId: String(inserted.id) }
}

/**
 * Remove stored credentials while preserving the row and its audit fields.
 *
 * Used when a merchant disconnects, or when Shift4 revokes an access token and a
 * new Auth Token must be supplied by the merchant's Lighthouse Transaction
 * Manager Account Administrator.
 *
 * With `channel` omitted every credential is cleared. With a channel supplied
 * only that channel is cleared, and the row stays `connected` when the other
 * channel still holds a usable token.
 */
export async function clearShift4RestCredential(
  merchantId: string,
  status: Extract<Shift4RestConnectionStatus, "disconnected" | "revoked"> = "disconnected",
  channel?: Shift4RestConnectionChannel
): Promise<void> {
  const row = await loadRow(merchantId)
  if (!row?.id) return

  const document = normalizeCredentialDocument(row)
  const now = new Date().toISOString()

  /** Strip the ciphertext, keep the non-secret audit evidence. */
  const retainEvidence = (
    credential: Shift4RestChannelCredential
  ): Shift4RestChannelCredential => ({
    environment: credential.environment,
    access_token_fingerprint: credential.access_token_fingerprint,
    interface_name: credential.interface_name,
    interface_version: credential.interface_version,
    company_name: credential.company_name,
    connected_at: credential.connected_at,
    last_exchange_correlation_id: credential.last_exchange_correlation_id,
    revoked_at: now,
    card_processing_verified: false,
  })

  const channels: Shift4RestCredentialsV2["channels"] = {}
  for (const name of SHIFT4_REST_CONNECTION_CHANNELS) {
    const credential = document.channels[name]
    if (!credential) continue
    channels[name] = !channel || channel === name ? retainEvidence(credential) : credential
  }

  const credentials: Shift4RestCredentialsV2 = {
    provider_model: "shift4_payment_platform_rest",
    credential_version: SHIFT4_REST_CREDENTIAL_VERSION,
    channels,
  }
  if (document.legacyShared) {
    // A targeted single-channel clear leaves the legacy credential alone; a
    // full clear strips its ciphertext too.
    credentials.legacy_shared = channel
      ? document.legacyShared
      : retainEvidence(document.legacyShared)
  }

  const stillConnected = SHIFT4_REST_CONNECTION_CHANNELS.some((name) =>
    isShift4EncryptedSecret(channels[name]?.access_token)
  )

  const { error } = await serviceRoleDb()
    .from("merchant_providers")
    .update({
      credentials,
      status: stillConnected ? "connected" : status,
      enabled: false,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("merchant_id", merchantId)
    .eq("provider", SHIFT4_REST_PROVIDER_NAME)

  if (error) {
    throw new Error(`Failed to clear the Shift4 REST credential: ${error.message}`)
  }
}
