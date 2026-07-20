import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "merchant_withdrawal_destinations"
const MAX_DESTINATIONS_PER_MERCHANT_RAIL = 25

export type WithdrawalDestinationRail = "base" | "solana" | "bitcoin"
export type WithdrawalDestinationAsset = "ETH" | "USDC" | "SOL" | "BTC"
export type WithdrawalDestinationMethod = "onchain" | "lightning"

export type MerchantWithdrawalDestination = {
  id: string
  merchant_id: string
  rail: WithdrawalDestinationRail
  asset: WithdrawalDestinationAsset
  method: WithdrawalDestinationMethod | null
  destination_address: string
  label: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export type CreateWithdrawalDestinationInput = {
  merchantId: string
  rail: WithdrawalDestinationRail
  asset: WithdrawalDestinationAsset
  method: WithdrawalDestinationMethod | null
  destinationAddress: string
  label?: string
  isDefault?: boolean
}

function normalize(row: Record<string, unknown>): MerchantWithdrawalDestination {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    rail: String(row.rail || "base") as WithdrawalDestinationRail,
    asset: String(row.asset || "ETH") as WithdrawalDestinationAsset,
    method: row.method != null ? (String(row.method) as WithdrawalDestinationMethod) : null,
    destination_address: String(row.destination_address || ""),
    label: String(row.label || ""),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

/**
 * Rail-aware: callers must always pass `rail` (and, for Bitcoin, filter by
 * `method` too) so a saved Lightning destination never surfaces while the
 * merchant is withdrawing on Bitcoin Network, and vice versa.
 */
export async function listWithdrawalDestinations(
  merchantId: string,
  filter: { rail?: WithdrawalDestinationRail; method?: WithdrawalDestinationMethod } = {}
): Promise<MerchantWithdrawalDestination[]> {
  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })

  if (filter.rail) query = query.eq("rail", filter.rail)
  if (filter.method) query = query.eq("method", filter.method)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list withdrawal destinations: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function getWithdrawalDestination(
  merchantId: string,
  id: string
): Promise<MerchantWithdrawalDestination | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load withdrawal destination: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function countWithdrawalDestinationsForRail(
  merchantId: string,
  rail: WithdrawalDestinationRail
): Promise<number> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)
    .eq("rail", rail)

  if (error) throw new Error(`Failed to count withdrawal destinations: ${error.message}`)
  return count ?? 0
}

export async function createWithdrawalDestination(
  input: CreateWithdrawalDestinationInput
): Promise<MerchantWithdrawalDestination> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      method: input.method,
      destination_address: input.destinationAddress.trim(),
      label: input.label?.trim() || "",
      is_default: Boolean(input.isDefault),
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to save withdrawal destination: ${error?.message || "No data returned"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export async function deleteWithdrawalDestination(merchantId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) throw new Error(`Failed to delete withdrawal destination: ${error.message}`)
}

export { MAX_DESTINATIONS_PER_MERCHANT_RAIL }
