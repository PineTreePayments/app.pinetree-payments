import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_wallet_balance_snapshots"

export type MerchantWalletBalanceSnapshot = {
  id: string
  merchant_id: string
  provider: string
  asset: string
  network: string
  available_base_units: string
  pending_base_units: string
  total_base_units: string
  provider_updated_at: string | null
  cached_at: string
  created_at: string
  updated_at: string
}

export async function listWalletBalanceSnapshots(
  merchantId: string,
  provider = "speed"
): Promise<MerchantWalletBalanceSnapshot[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .order("asset", { ascending: true })

  if (error) throw new Error(`Failed to load wallet balance snapshots: ${error.message}`)
  return (data ?? []) as MerchantWalletBalanceSnapshot[]
}

export async function upsertWalletBalanceSnapshot(input: {
  merchantId: string
  provider?: string
  asset: string
  network?: string
  availableBaseUnits: bigint
  pendingBaseUnits?: bigint
  totalBaseUnits: bigint
  providerUpdatedAt?: string | null
}): Promise<MerchantWalletBalanceSnapshot> {
  const now = new Date().toISOString()
  const row = {
    merchant_id: input.merchantId,
    provider: input.provider ?? "speed",
    asset: input.asset,
    network: input.network ?? "",
    available_base_units: input.availableBaseUnits.toString(),
    pending_base_units: (input.pendingBaseUnits ?? BigInt(0)).toString(),
    total_base_units: input.totalBaseUnits.toString(),
    provider_updated_at: input.providerUpdatedAt ?? null,
    cached_at: now,
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "merchant_id,provider,asset,network" })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to save wallet balance snapshot: ${error?.message ?? "unknown error"}`)
  }
  return data as MerchantWalletBalanceSnapshot
}
