import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "lightning_settlement_settings"

export type LightningSettlementProviderSyncStatus =
  | "not_synced"
  | "synced"
  | "pending"
  | "failed"
  | "not_available"

export type LightningSettlementSettings = {
  id: string
  merchant_id: string
  provider: string
  enabled: boolean
  autoswap_enabled: boolean
  payout_destination_id: string | null
  provider_account_id: string | null
  provider_reference: string | null
  provider_sync_status: LightningSettlementProviderSyncStatus
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type UpsertLightningSettlementSettingsInput = {
  merchantId: string
  enabled?: boolean
  autoswapEnabled?: boolean
  payoutDestinationId?: string | null
  providerAccountId?: string | null
  providerReference?: string | null
  providerSyncStatus?: LightningSettlementProviderSyncStatus
  lastError?: string | null
}

function normalize(row: Record<string, unknown>): LightningSettlementSettings {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    provider: String(row.provider || "speed"),
    enabled: Boolean(row.enabled),
    autoswap_enabled: Boolean(row.autoswap_enabled),
    payout_destination_id: row.payout_destination_id != null ? String(row.payout_destination_id) : null,
    provider_account_id: row.provider_account_id != null ? String(row.provider_account_id) : null,
    provider_reference: row.provider_reference != null ? String(row.provider_reference) : null,
    provider_sync_status: String(row.provider_sync_status || "not_synced") as LightningSettlementProviderSyncStatus,
    last_synced_at: row.last_synced_at != null ? String(row.last_synced_at) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function getLightningSettlementSettings(
  merchantId: string
): Promise<LightningSettlementSettings | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load Lightning settlement settings: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function upsertLightningSettlementSettings(
  input: UpsertLightningSettlementSettingsInput
): Promise<LightningSettlementSettings> {
  const existing = await getLightningSettlementSettings(input.merchantId)
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({
      id: existing?.id,
      merchant_id: input.merchantId,
      provider: "speed",
      enabled: input.enabled ?? existing?.enabled ?? false,
      autoswap_enabled: input.autoswapEnabled ?? existing?.autoswap_enabled ?? false,
      payout_destination_id: input.payoutDestinationId !== undefined
        ? input.payoutDestinationId
        : existing?.payout_destination_id ?? null,
      provider_account_id: input.providerAccountId !== undefined
        ? input.providerAccountId
        : existing?.provider_account_id ?? null,
      provider_reference: input.providerReference !== undefined
        ? input.providerReference
        : existing?.provider_reference ?? null,
      provider_sync_status: input.providerSyncStatus || existing?.provider_sync_status || "not_synced",
      last_synced_at: input.providerSyncStatus === "synced" ? now : existing?.last_synced_at ?? null,
      last_error: input.lastError !== undefined ? input.lastError : existing?.last_error ?? null,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to save Lightning settlement settings: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}
