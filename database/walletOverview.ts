import { supabase, supabaseAdmin } from "./supabase"

export type MerchantWalletRow = {
  id: string
  merchant_id: string
  network: string
  wallet_address: string
  wallet_type?: string | null
  provider?: string | null
}

const db = supabaseAdmin || supabase

export async function getMerchantWalletRows(merchantId: string) {
  const { data, error } = await db
    .from("merchant_wallets")
    .select("id, merchant_id, network, wallet_address, wallet_type, provider")
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed to load merchant wallets: ${error.message}`)
  }

  return (data || []) as MerchantWalletRow[]
}

export async function getMerchantAssetBalances(merchantId: string) {
  const { data, error } = await db
    .from("wallet_balances")
    .select("asset, balance")
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed to load wallet balances: ${error.message}`)
  }

  return (data || []) as Array<{ asset: string; balance: number | string | null }>
}

export async function upsertMerchantAssetBalances(
  merchantId: string,
  balances: Array<{ asset: string; balance: number }>,
  timestamp: string
) {
  if (balances.length === 0) return

  const updates = balances.map((b) => ({
    merchant_id: merchantId,
    asset: b.asset,
    balance: b.balance,
    last_updated: timestamp
  }))

  const { error } = await db
    .from("wallet_balances")
    .upsert(updates, { onConflict: "merchant_id,asset" })

  if (error) {
    throw new Error(`Failed to upsert wallet balances: ${error.message}`)
  }
}

export async function setSystemLastRun(timestamp: string) {
  const { error } = await db
    .from("system_status")
    .upsert({ id: 1, last_run: timestamp })

  if (error) {
    // non-fatal for local/dev environments with strict RLS
    console.warn("Failed to update system_status:", error.message)
  }
}

export async function getSystemLastRun() {
  const { data, error } = await db
    .from("system_status")
    .select("last_run")
    .eq("id", 1)
    .maybeSingle()

  if (error) {
    return null
  }

  return data?.last_run ?? null
}
