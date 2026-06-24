import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "pinetree_wallet_rail_syncs"

export type WalletRailSyncRecord = {
  id: string
  merchant_id: string
  rail: "solana" | "base"
  synced_address: string
  synced_at: string
}

export async function getWalletRailSyncs(merchantId: string): Promise<WalletRailSyncRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)

  if (error) throw new Error(`Failed to load rail syncs: ${error.message}`)
  return (data || []) as WalletRailSyncRecord[]
}

export async function upsertWalletRailSync(input: {
  merchantId: string
  rail: "solana" | "base"
  syncedAddress: string
}): Promise<WalletRailSyncRecord> {
  const row = {
    merchant_id: input.merchantId,
    rail: input.rail,
    synced_address: input.syncedAddress,
    synced_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "merchant_id,rail" })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to upsert rail sync for ${input.rail}: ${error?.message ?? "unknown"}`)
  }

  return data as WalletRailSyncRecord
}
