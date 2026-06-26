import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "merchant_payout_destinations"

export type MerchantPayoutDestinationType =
  | "pinetree_btc_wallet"
  | "external_btc_wallet"
  | "speed_connected_account"

export type MerchantPayoutDestinationStatus = "active" | "disabled" | "pending_verification"

export type MerchantPayoutDestination = {
  id: string
  merchant_id: string
  rail: string
  asset: string
  destination_type: MerchantPayoutDestinationType
  destination_address: string
  label: string | null
  status: MerchantPayoutDestinationStatus
  verified_at: string | null
  provider: string | null
  provider_reference: string | null
  created_at: string
  updated_at: string
}

export type UpsertMerchantPayoutDestinationInput = {
  merchantId: string
  rail: string
  asset: string
  destinationType: MerchantPayoutDestinationType
  destinationAddress: string
  label?: string | null
  status?: MerchantPayoutDestinationStatus
  provider?: string | null
  providerReference?: string | null
  verifiedAt?: string | null
}

function normalize(row: Record<string, unknown>): MerchantPayoutDestination {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    rail: String(row.rail || ""),
    asset: String(row.asset || ""),
    destination_type: String(row.destination_type || "external_btc_wallet") as MerchantPayoutDestinationType,
    destination_address: String(row.destination_address || ""),
    label: row.label != null ? String(row.label) : null,
    status: String(row.status || "active") as MerchantPayoutDestinationStatus,
    verified_at: row.verified_at != null ? String(row.verified_at) : null,
    provider: row.provider != null ? String(row.provider) : null,
    provider_reference: row.provider_reference != null ? String(row.provider_reference) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function listMerchantPayoutDestinations(
  merchantId: string,
  options: { rail?: string; asset?: string; activeOnly?: boolean } = {}
): Promise<MerchantPayoutDestination[]> {
  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })

  if (options.rail) query = query.eq("rail", options.rail)
  if (options.asset) query = query.eq("asset", options.asset)
  if (options.activeOnly) query = query.eq("status", "active")

  const { data, error } = await query
  if (error) throw new Error(`Failed to list payout destinations: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function getMerchantPayoutDestination(
  merchantId: string,
  id: string
): Promise<MerchantPayoutDestination | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load payout destination: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function getActiveMerchantPayoutDestination(
  merchantId: string,
  id: string
): Promise<MerchantPayoutDestination | null> {
  const destination = await getMerchantPayoutDestination(merchantId, id)
  return destination?.status === "active" ? destination : null
}

export async function upsertMerchantPayoutDestination(
  input: UpsertMerchantPayoutDestinationInput
): Promise<MerchantPayoutDestination> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({
      merchant_id: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      destination_type: input.destinationType,
      destination_address: input.destinationAddress.trim(),
      label: input.label || null,
      status: input.status || "active",
      verified_at: input.verifiedAt || null,
      provider: input.provider || null,
      provider_reference: input.providerReference || null,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to save payout destination: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}
