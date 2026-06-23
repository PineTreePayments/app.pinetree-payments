import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_lightning_profiles"

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
  speed_connected_account_status: string | null
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
  speedConnectedAccountStatus?: string | null
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
    speed_connected_account_status: input.speedConnectedAccountStatus !== undefined
      ? input.speedConnectedAccountStatus
      : existing?.speed_connected_account_status ?? null,
    receive_mode: "invoice" as const,
    setup_source: "pinetree_managed" as const,
    last_checked_at: now,
    updated_at: now,
    ...(existing ? {} : { created_at: now }),
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
    ...(speedAccountId ? { speedConnectedAccountId: speedAccountId } : {}),
  })
}
