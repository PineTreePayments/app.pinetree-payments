import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

const TABLE = "merchant_settlement_destinations"
const MAX_DESTINATIONS_PER_MERCHANT = 20

export type SettlementDestinationRecord = {
  id: string
  merchant_id: string
  label: string
  exchange_name: string
  asset: string
  network: string
  address: string
  memo_or_tag: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export type CreateSettlementDestinationInput = {
  merchantId: string
  label: string
  exchangeName: string
  asset: string
  network: string
  address: string
  memoOrTag?: string | null
  isDefault?: boolean
}

export type UpdateSettlementDestinationInput = {
  merchantId: string
  id: string
  label?: string
  exchangeName?: string
  asset?: string
  network?: string
  address?: string
  memoOrTag?: string | null
  isDefault?: boolean
}

function normalize(row: Record<string, unknown>): SettlementDestinationRecord {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    label: String(row.label || ""),
    exchange_name: String(row.exchange_name || ""),
    asset: String(row.asset || ""),
    network: String(row.network || ""),
    address: String(row.address || ""),
    memo_or_tag: row.memo_or_tag != null ? String(row.memo_or_tag) : null,
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  }
}

export async function listSettlementDestinations(
  merchantId: string
): Promise<SettlementDestinationRecord[]> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_DESTINATIONS_PER_MERCHANT)

  if (error) {
    throw new Error(`Failed to list settlement destinations: ${error.message}`)
  }

  return ((data || []) as Record<string, unknown>[]).map(normalize)
}

export async function getSettlementDestination(
  merchantId: string,
  id: string
): Promise<SettlementDestinationRecord | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to get settlement destination: ${error.message}`)
  }

  return data ? normalize(data as Record<string, unknown>) : null
}

export async function countSettlementDestinations(merchantId: string): Promise<number> {
  const { count, error } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed to count settlement destinations: ${error.message}`)
  }

  return count ?? 0
}

export async function createSettlementDestination(
  input: CreateSettlementDestinationInput
): Promise<SettlementDestinationRecord> {
  const now = new Date().toISOString()

  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      label: input.label.trim(),
      exchange_name: input.exchangeName.trim(),
      asset: input.asset.trim().toUpperCase(),
      network: input.network.trim().toLowerCase(),
      address: input.address.trim(),
      memo_or_tag: input.memoOrTag?.trim() || null,
      is_default: Boolean(input.isDefault),
      updated_at: now
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create settlement destination: ${error?.message || "No data returned"}`)
  }

  return normalize(data as Record<string, unknown>)
}

export async function updateSettlementDestination(
  input: UpdateSettlementDestinationInput
): Promise<SettlementDestinationRecord> {
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: now }

  if (input.label !== undefined)       update.label        = input.label.trim()
  if (input.exchangeName !== undefined) update.exchange_name = input.exchangeName.trim()
  if (input.asset !== undefined)       update.asset        = input.asset.trim().toUpperCase()
  if (input.network !== undefined)     update.network      = input.network.trim().toLowerCase()
  if (input.address !== undefined)     update.address      = input.address.trim()
  if (input.memoOrTag !== undefined)   update.memo_or_tag  = input.memoOrTag?.trim() || null
  if (input.isDefault !== undefined)   update.is_default   = Boolean(input.isDefault)

  const { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq("merchant_id", input.merchantId)
    .eq("id", input.id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to update settlement destination: ${error?.message || "Not found"}`)
  }

  return normalize(data as Record<string, unknown>)
}

export async function deleteSettlementDestination(
  merchantId: string,
  id: string
): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) {
    throw new Error(`Failed to delete settlement destination: ${error.message}`)
  }
}

export async function setDefaultSettlementDestination(
  merchantId: string,
  id: string
): Promise<void> {
  const now = new Date().toISOString()

  // Fetch the target destination to scope the clear to its asset+network only.
  // This allows one preferred destination per merchant per asset+network combination.
  const { data: target } = await db
    .from(TABLE)
    .select("asset, network")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (target) {
    // Clear preferred only for the same asset+network — other combinations are unaffected
    await db
      .from(TABLE)
      .update({ is_default: false, updated_at: now })
      .eq("merchant_id", merchantId)
      .eq("is_default", true)
      .eq("asset", String(target.asset || ""))
      .eq("network", String(target.network || ""))
  }

  await db
    .from(TABLE)
    .update({ is_default: true, updated_at: now })
    .eq("merchant_id", merchantId)
    .eq("id", id)
}

export { MAX_DESTINATIONS_PER_MERCHANT }
