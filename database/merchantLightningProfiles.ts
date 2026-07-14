import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_lightning_profiles"

function speedAccountId(value?: string | null): string | null {
  const id = String(value || "").trim()
  return id.startsWith("acct_") ? id : null
}

function speedRelationshipId(value?: string | null): string | null {
  const id = String(value || "").trim()
  return id.startsWith("ca_") ? id : null
}

export type MerchantLightningProfileStatus =
  | "not_configured"
  | "pending"
  | "ready"
  | "needs_attention"

export type MerchantLightningProfile = {
  id: string
  merchant_id: string
  provider: "speed"
  status: MerchantLightningProfileStatus
  speed_connected_account_id: string | null
  speed_connected_account_relationship_id: string | null
  speed_account_id: string | null
  // Provider-confirmed X-Speed-Account header value for Instant Send calls -
  // deliberately separate from speed_account_id/speed_connected_account_relationship_id.
  // NULL until Speed confirms the ca_ vs acct_ identifier format. See
  // providers/lightning/speedHeaderAccountResolver.ts - never inferred automatically.
  speed_header_account_id: string | null
  speed_connected_account_status: string | null
  speed_connect_setup_url: string | null
  managed_account_email: string | null
  provider_response_summary: Record<string, unknown> | null
  provider_error_message: string | null
  receive_mode: "invoice"
  setup_source: "pinetree_managed"
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export type UpsertLightningProfileInput = {
  merchantId: string
  status?: MerchantLightningProfileStatus
  speedConnectedAccountId?: string | null
  speedConnectedAccountRelationshipId?: string | null
  speedAccountId?: string | null
  speedHeaderAccountId?: string | null
  speedConnectedAccountStatus?: string | null
  speedConnectSetupUrl?: string | null
  managedAccountEmail?: string | null
  providerResponseSummary?: Record<string, unknown> | null
  providerErrorMessage?: string | null
}

export type LightningReadiness = {
  ready: boolean
  pending: boolean
  configured: boolean
  needsAttention: boolean
  status: MerchantLightningProfileStatus
}

export function deriveLightningReadiness(
  profile: MerchantLightningProfile | null
): LightningReadiness {
  if (!profile) {
    return { ready: false, pending: false, configured: false, needsAttention: false, status: "not_configured" }
  }
  return {
    ready: profile.status === "ready",
    pending: profile.status === "pending",
    configured: profile.status !== "not_configured",
    needsAttention: profile.status === "needs_attention",
    status: profile.status,
  }
}

export async function getMerchantLightningProfile(
  merchantId: string
): Promise<MerchantLightningProfile | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error || !data) return null
  return data as MerchantLightningProfile
}

/**
 * Resolves which merchant a Speed connected-account webhook event belongs to
 * by matching the event's account_id against the canonical Speed merchant
 * account identifier saved on merchant_lightning_profiles.speed_account_id
 * (response.account_id from a successful /connect/custom creation). Returns
 * null for an empty id or no match - never guesses a merchant.
 */
export async function getMerchantIdBySpeedAccountId(accountId: string): Promise<string | null> {
  const id = String(accountId || "").trim()
  if (!id) return null

  const { data, error } = await supabase
    .from(TABLE)
    .select("merchant_id")
    .eq("speed_account_id", id)
    .maybeSingle()

  if (error || !data) return null
  return String((data as { merchant_id: string }).merchant_id)
}

export async function upsertMerchantLightningProfile(
  input: UpsertLightningProfileInput
): Promise<MerchantLightningProfile> {
  const now = new Date().toISOString()

  const existing = await getMerchantLightningProfile(input.merchantId)

  const row = {
    merchant_id: input.merchantId,
    provider: "speed" as const,
    status: input.status ?? existing?.status ?? "not_configured",
    speed_connected_account_id: input.speedConnectedAccountId !== undefined
      ? input.speedConnectedAccountId
      : existing?.speed_connected_account_id ?? null,
    speed_connected_account_relationship_id: input.speedConnectedAccountRelationshipId !== undefined
      ? speedRelationshipId(input.speedConnectedAccountRelationshipId)
      : speedRelationshipId(existing?.speed_connected_account_relationship_id),
    speed_account_id: input.speedAccountId !== undefined
      ? speedAccountId(input.speedAccountId)
      : speedAccountId(existing?.speed_account_id),
    speed_connected_account_status: input.speedConnectedAccountStatus !== undefined
      ? input.speedConnectedAccountStatus
      : existing?.speed_connected_account_status ?? null,
    speed_connect_setup_url: input.speedConnectSetupUrl !== undefined
      ? input.speedConnectSetupUrl
      : existing?.speed_connect_setup_url ?? null,
    managed_account_email: input.managedAccountEmail !== undefined
      ? input.managedAccountEmail
      : existing?.managed_account_email ?? null,
    provider_response_summary: input.providerResponseSummary !== undefined
      ? input.providerResponseSummary
      : existing?.provider_response_summary ?? null,
    provider_error_message: input.providerErrorMessage !== undefined
      ? input.providerErrorMessage
      : existing?.provider_error_message ?? null,
    receive_mode: "invoice" as const,
    setup_source: "pinetree_managed" as const,
    last_checked_at: now,
    updated_at: now,
    ...(existing ? {} : { created_at: now }),
  }

  // speed_header_account_id is for a later Instant Send contract question and
  // is not required for Custom Connect intake. Some restored production
  // schemas do not have the column yet, so only write it when explicitly set
  // or when an existing selected row proves the column is present.
  if (
    input.speedHeaderAccountId !== undefined ||
    (existing && Object.prototype.hasOwnProperty.call(existing, "speed_header_account_id"))
  ) {
    ;(row as Record<string, unknown>).speed_header_account_id =
      input.speedHeaderAccountId !== undefined
        ? input.speedHeaderAccountId
        : existing?.speed_header_account_id ?? null
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "merchant_id" })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to save Lightning profile: ${error?.message ?? "unknown error"}`)
  }

  return data as MerchantLightningProfile
}

export async function markMerchantLightningPending(
  merchantId: string
): Promise<MerchantLightningProfile> {
  return upsertMerchantLightningProfile({ merchantId, status: "pending" })
}

export async function markMerchantLightningReady(
  merchantId: string,
  speedAccountId?: string
): Promise<MerchantLightningProfile> {
  return upsertMerchantLightningProfile({
    merchantId,
    status: "ready",
    ...(speedAccountId ? { speedConnectedAccountId: speedAccountId, speedAccountId } : {}),
  })
}
