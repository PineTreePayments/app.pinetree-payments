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
import type { Shift4RestEnvironment } from "@/providers/shift4/rest/config"

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

/**
 * Which Shift4 channel the connection was established for.
 *
 * Shift4 scopes an access token to one merchant account and interface. Retail
 * (Commerce Engine for Cloud + PAX) and e-commerce (i4Go) may or may not share a
 * merchant account for a given merchant; that is a per-merchant Shift4 setup
 * question, not something PineTree can infer. Recording the channel now keeps
 * the distinction available to the Engine phase without guessing at it, and
 * `shared` is the honest default when only one exchange has been performed.
 */
export type Shift4RestChannel = "retail" | "ecommerce" | "shared"

/** Connection status values written by the Engine. */
export type Shift4RestConnectionStatus = "connected" | "disconnected" | "revoked"

/**
 * The credentials JSONB shape. `access_token` holds the AES-256-GCM envelope,
 * never a plaintext token. Every other field is non-secret audit evidence.
 */
type Shift4RestCredentials = {
  provider_model: "shift4_payment_platform_rest"
  environment: Shift4RestEnvironment
  channel: Shift4RestChannel
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
   * device is activated, or that card processing may go live. Phase 1 always
   * records false; only a later Engine phase, with real payment evidence, may
   * change it.
   */
  card_processing_verified: false
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
  /** Always false in Phase 1. Authentication is not boarding. */
  cardProcessingVerified: boolean
}

type ProviderRow = {
  id: string
  status: string | null
  enabled: boolean | null
  credentials: unknown
}

function readCredentials(row: ProviderRow | null): Shift4RestCredentials | null {
  if (!row?.credentials || typeof row.credentials !== "object") return null
  return row.credentials as Shift4RestCredentials
}

function toStatusView(row: ProviderRow): Shift4RestConnectionStatusView {
  const credentials = readCredentials(row)
  const envelope = credentials?.access_token
  return {
    connectionId: String(row.id),
    status: String(row.status || ""),
    enabled: row.enabled === true,
    connected: String(row.status || "") === "connected" && isShift4EncryptedSecret(envelope),
    environment: credentials?.environment ?? null,
    accessTokenPresent: isShift4EncryptedSecret(envelope),
    accessTokenFingerprint: credentials?.access_token_fingerprint ?? null,
    interfaceName: credentials?.interface_name ?? null,
    interfaceVersion: credentials?.interface_version ?? null,
    companyName: credentials?.company_name ?? null,
    connectedAt: credentials?.connected_at ?? null,
    lastExchangeCorrelationId: credentials?.last_exchange_correlation_id ?? null,
    lastExchangeServerName: credentials?.last_exchange_server_name ?? null,
    channel: credentials?.channel ?? null,
    // Read defensively from the raw JSONB rather than the narrowed type: the
    // stored type pins this to false for Phase 1, but the column is JSONB and a
    // future phase may write true, so the view must reflect what is actually
    // stored instead of a compile-time constant.
    cardProcessingVerified:
      (row.credentials as Record<string, unknown> | null)?.card_processing_verified === true,
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

/**
 * Resolve the merchant's decrypted Shift4 access token.
 *
 * SERVER-ONLY. The return value is a live credential: pass it straight into the
 * Shift4 client and never place it in an API response, a log, an error, or a
 * database column.
 */
export async function getShift4RestAccessToken(merchantId: string): Promise<{
  connectionId: string
  environment: Shift4RestEnvironment
  accessToken: string
} | null> {
  const row = await loadRow(merchantId)
  if (!row || String(row.status || "") !== "connected") return null

  const credentials = readCredentials(row)
  const envelope = credentials?.access_token
  if (!isShift4EncryptedSecret(envelope) || !credentials?.environment) return null

  return {
    connectionId: String(row.id),
    environment: credentials.environment,
    accessToken: decryptShift4AccessToken(envelope),
  }
}

/**
 * Persist the encrypted access token and the non-secret exchange evidence.
 *
 * Uses the existing unique (merchant_id, provider) relationship, so a repeated
 * exchange replaces the credential in place rather than creating a second row.
 */
export async function saveShift4RestConnection(input: {
  merchantId: string
  encryptedAccessToken: Shift4EncryptedSecret
  accessTokenFingerprint: string
  environment: Shift4RestEnvironment
  interfaceName: string
  interfaceVersion: string
  companyName: string
  correlationId: string
  serverName: string | null
  providerDateTime: string | null
  channel?: Shift4RestChannel
}): Promise<{ connectionId: string }> {
  if (!isShift4EncryptedSecret(input.encryptedAccessToken)) {
    throw new Error("Refusing to store a Shift4 access token that is not an encrypted envelope.")
  }

  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("A merchant is required to store a Shift4 REST connection.")
  }

  const now = new Date().toISOString()
  const credentials: Shift4RestCredentials = {
    provider_model: "shift4_payment_platform_rest",
    environment: input.environment,
    channel: input.channel ?? "shared",
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
      // The credential exists but no payment path is built yet, so the
      // connection stays disabled until its Engine phase enables it.
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
 * Remove the stored credential while preserving the row and its audit fields.
 *
 * Used when a merchant disconnects, or when Shift4 revokes an access token and a
 * new Auth Token must be supplied by the merchant's Lighthouse Transaction
 * Manager Account Administrator.
 */
export async function clearShift4RestCredential(
  merchantId: string,
  status: Extract<Shift4RestConnectionStatus, "disconnected" | "revoked"> = "disconnected"
): Promise<void> {
  const row = await loadRow(merchantId)
  if (!row?.id) return

  const credentials = readCredentials(row)
  const now = new Date().toISOString()

  // `access_token` is intentionally absent: clearing removes the ciphertext and
  // keeps only non-secret audit evidence.
  const retained: Shift4RestCredentials = {
    provider_model: "shift4_payment_platform_rest",
    environment: credentials?.environment ?? "test",
    channel: credentials?.channel ?? "shared",
    access_token_fingerprint: credentials?.access_token_fingerprint,
    interface_name: credentials?.interface_name,
    interface_version: credentials?.interface_version,
    company_name: credentials?.company_name,
    connected_at: credentials?.connected_at,
    last_exchange_correlation_id: credentials?.last_exchange_correlation_id,
    revoked_at: now,
    card_processing_verified: false,
  }

  const { error } = await serviceRoleDb()
    .from("merchant_providers")
    .update({ credentials: retained, status, enabled: false, updated_at: now })
    .eq("id", row.id)
    .eq("merchant_id", merchantId)
    .eq("provider", SHIFT4_REST_PROVIDER_NAME)

  if (error) {
    throw new Error(`Failed to clear the Shift4 REST credential: ${error.message}`)
  }
}
