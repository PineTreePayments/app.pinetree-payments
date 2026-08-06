/**
 * PineTree service-provider terms acceptance - persistence.
 *
 * Append-only consent evidence. PineTree may not create a customer with any
 * regulated infrastructure partner (currently Bridge) until a valid acceptance
 * of the CURRENT terms version exists for the merchant.
 *
 * TENANT SAFETY: every read and write filters by merchant_id. The service-role
 * client bypasses RLS, so the merchant filter here IS the isolation boundary.
 *
 * SECURITY: no identity documents, provider payloads, or credentials are ever
 * written here - only the fact of acceptance and who made it.
 */

import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

const TABLE = "merchant_service_terms_acceptances"

/**
 * The current PineTree terms bundle.
 *
 * Bump this ONLY when the merchant-facing disclosure materially changes.
 * Bumping it invalidates prior consent: merchants are asked to accept again
 * before any new partner submission, which is the point of versioning.
 */
export const CURRENT_SERVICE_TERMS_VERSION = "2026-08-06.v1" as const

/**
 * Infrastructure partners disclosed by the current terms version.
 *
 * Recorded with each acceptance so that adding a partner later is provably
 * NOT covered by an older acceptance.
 */
export const DISCLOSED_SERVICE_PROVIDERS = ["bridge"] as const

export type MerchantServiceTermsAcceptance = {
  id: string
  merchantId: string
  termsVersion: string
  disclosedProviders: string[]
  actorUserId: string | null
  acceptedAt: string
}

function toRecord(data: {
  id?: unknown
  merchant_id?: unknown
  terms_version?: unknown
  disclosed_providers?: unknown
  actor_user_id?: unknown
  accepted_at?: unknown
}): MerchantServiceTermsAcceptance {
  return {
    id: String(data.id || ""),
    merchantId: String(data.merchant_id || ""),
    termsVersion: String(data.terms_version || ""),
    disclosedProviders: Array.isArray(data.disclosed_providers)
      ? data.disclosed_providers.map((entry) => String(entry))
      : [],
    actorUserId: data.actor_user_id ? String(data.actor_user_id) : null,
    acceptedAt: String(data.accepted_at || ""),
  }
}

/** The merchant's most recent acceptance, or null when they have never accepted. */
export async function getLatestServiceTermsAcceptance(
  merchantId: string
): Promise<MerchantServiceTermsAcceptance | null> {
  const normalizedMerchantId = String(merchantId || "").trim()
  if (!normalizedMerchantId) return null

  const { data, error } = await db
    .from(TABLE)
    .select("id, merchant_id, terms_version, disclosed_providers, actor_user_id, accepted_at")
    .eq("merchant_id", normalizedMerchantId)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed loading service terms acceptance: ${error.message}`)
  if (!data) return null
  return toRecord(data)
}

/**
 * Record an acceptance.
 *
 * Idempotent: re-submitting the same (merchant, version) returns the existing
 * row rather than inflating the audit trail or throwing. A merchant who
 * double-clicks Accept produces exactly one consent record.
 */
export async function recordServiceTermsAcceptance(input: {
  merchantId: string
  termsVersion: string
  disclosedProviders: readonly string[]
  actorUserId: string | null
  sourceIp?: string | null
  userAgent?: string | null
}): Promise<MerchantServiceTermsAcceptance> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) throw new Error("A merchant id is required to record terms acceptance.")

  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id: merchantId,
      terms_version: input.termsVersion,
      disclosed_providers: [...input.disclosedProviders],
      actor_user_id: input.actorUserId,
      source_ip: input.sourceIp || null,
      // Bounded by the database constraint; truncated here so a long header
      // never turns a consent write into a failure.
      user_agent: input.userAgent ? String(input.userAgent).slice(0, 400) : null,
    })
    .select("id, merchant_id, terms_version, disclosed_providers, actor_user_id, accepted_at")
    .single()

  if (!error) return toRecord(data)

  if (error.code === "23505") {
    const existing = await getServiceTermsAcceptanceByVersion(merchantId, input.termsVersion)
    if (existing) return existing
  }

  throw new Error(`Failed recording service terms acceptance: ${error.message}`)
}

export async function getServiceTermsAcceptanceByVersion(
  merchantId: string,
  termsVersion: string
): Promise<MerchantServiceTermsAcceptance | null> {
  const normalizedMerchantId = String(merchantId || "").trim()
  if (!normalizedMerchantId) return null

  const { data, error } = await db
    .from(TABLE)
    .select("id, merchant_id, terms_version, disclosed_providers, actor_user_id, accepted_at")
    .eq("merchant_id", normalizedMerchantId)
    .eq("terms_version", termsVersion)
    .maybeSingle()

  if (error) throw new Error(`Failed loading service terms acceptance: ${error.message}`)
  if (!data) return null
  return toRecord(data)
}

/**
 * True when the merchant has accepted the CURRENT terms version and that
 * acceptance disclosed the provider about to be used.
 *
 * Fails closed: an older acceptance, or one that did not disclose the
 * provider, is not consent for that provider.
 */
export function isServiceTermsAcceptanceCurrent(
  acceptance: MerchantServiceTermsAcceptance | null,
  requiredProvider?: string
): boolean {
  if (!acceptance) return false
  if (acceptance.termsVersion !== CURRENT_SERVICE_TERMS_VERSION) return false
  if (requiredProvider && !acceptance.disclosedProviders.includes(requiredProvider)) return false
  return true
}
