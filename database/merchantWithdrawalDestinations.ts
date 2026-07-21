import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "merchant_withdrawal_destinations"
const MAX_DESTINATIONS_PER_MERCHANT_RAIL = 25

export type WithdrawalDestinationRail = "base" | "solana" | "bitcoin"
export type WithdrawalDestinationAsset = "ETH" | "USDC" | "SOL" | "BTC"
export type WithdrawalDestinationMethod = "onchain" | "lightning"
export type WithdrawalDestinationConfirmationStatus = "unconfirmed" | "confirmed"

export type MerchantWithdrawalDestination = {
  id: string
  merchant_id: string
  rail: WithdrawalDestinationRail
  asset: WithdrawalDestinationAsset
  method: WithdrawalDestinationMethod | null
  destination_address: string
  label: string
  is_default: boolean
  is_enabled: boolean
  provider_name: string | null
  memo_or_tag: string | null
  confirmation_status: WithdrawalDestinationConfirmationStatus
  merchant_confirmed_at: string | null
  last_used_at: string | null
  archived_at: string | null
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
  providerName?: string | null
  memoOrTag?: string | null
}

export type UpdateWithdrawalDestinationInput = {
  label?: string
  isDefault?: boolean
  isEnabled?: boolean
  providerName?: string | null
  memoOrTag?: string | null
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
    is_enabled: row.is_enabled !== undefined ? Boolean(row.is_enabled) : true,
    provider_name: row.provider_name != null ? String(row.provider_name) : null,
    memo_or_tag: row.memo_or_tag != null ? String(row.memo_or_tag) : null,
    confirmation_status: (row.confirmation_status === "confirmed" ? "confirmed" : "unconfirmed"),
    merchant_confirmed_at: row.merchant_confirmed_at != null ? String(row.merchant_confirmed_at) : null,
    last_used_at: row.last_used_at != null ? String(row.last_used_at) : null,
    archived_at: row.archived_at != null ? String(row.archived_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

/**
 * Rail-aware: callers must always pass `rail` (and, for Bitcoin, filter by
 * `method` too) so a saved Lightning destination never surfaces while the
 * merchant is withdrawing on Bitcoin Network, and vice versa.
 *
 * By default excludes archived rows. Pass `includeArchived: true` only for
 * history/audit views (e.g. rendering a past withdrawal's destination_id).
 */
export async function listWithdrawalDestinations(
  merchantId: string,
  filter: {
    rail?: WithdrawalDestinationRail
    method?: WithdrawalDestinationMethod
    includeArchived?: boolean
    includeDisabled?: boolean
  } = {}
): Promise<MerchantWithdrawalDestination[]> {
  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })

  if (filter.rail) query = query.eq("rail", filter.rail)
  if (filter.method) query = query.eq("method", filter.method)
  if (!filter.includeArchived) query = query.is("archived_at", null)
  if (!filter.includeDisabled) query = query.eq("is_enabled", true)

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
    .is("archived_at", null)

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
      provider_name: input.providerName?.trim() || null,
      memo_or_tag: input.memoOrTag?.trim() || null,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to save withdrawal destination: ${error?.message || "No data returned"}`)
  }
  return normalize(data as Record<string, unknown>)
}

/**
 * Edits non-sensitive metadata only. Rail/asset/method/destination_address
 * are identity-defining and part of the unique index - changing them
 * requires delete (or archive) + recreate, never an in-place edit.
 */
export async function updateWithdrawalDestination(
  merchantId: string,
  id: string,
  input: UpdateWithdrawalDestinationInput
): Promise<MerchantWithdrawalDestination> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.label !== undefined) patch.label = input.label.trim()
  if (input.isDefault !== undefined) patch.is_default = input.isDefault
  if (input.isEnabled !== undefined) patch.is_enabled = input.isEnabled
  if (input.providerName !== undefined) patch.provider_name = input.providerName?.trim() || null
  if (input.memoOrTag !== undefined) patch.memo_or_tag = input.memoOrTag?.trim() || null

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .maybeSingle()

  if (error) throw new Error(`Failed to update withdrawal destination: ${error.message}`)
  if (!data) throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  return normalize(data as Record<string, unknown>)
}

export async function confirmWithdrawalDestination(
  merchantId: string,
  id: string
): Promise<MerchantWithdrawalDestination> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .update({ confirmation_status: "confirmed", merchant_confirmed_at: now, updated_at: now })
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .maybeSingle()

  if (error) throw new Error(`Failed to confirm withdrawal destination: ${error.message}`)
  if (!data) throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  return normalize(data as Record<string, unknown>)
}

export async function markWithdrawalDestinationUsed(merchantId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) throw new Error(`Failed to update withdrawal destination usage: ${error.message}`)
}

/**
 * Archives (soft-deletes) a destination. Prefer this over
 * deleteWithdrawalDestination whenever the destination has ever been used
 * (last_used_at set) or might be referenced by withdrawal history - a hard
 * delete on a referenced row will fail at the DB layer (foreign key from
 * wallet_withdrawal_requests.destination_id / merchant_wallet_operations.destination_id).
 */
export async function archiveWithdrawalDestination(merchantId: string, id: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from(TABLE)
    .update({ archived_at: now, is_enabled: false, is_default: false, updated_at: now })
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) throw new Error(`Failed to archive withdrawal destination: ${error.message}`)
}

export async function deleteWithdrawalDestination(merchantId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) {
    // Postgres foreign_key_violation - a withdrawal or sweep rule still
    // references this destination. Translate into a friendly, actionable
    // error rather than leaking the raw constraint-name message.
    if (String((error as { code?: string }).code) === "23503") {
      throw Object.assign(
        new Error("This destination has withdrawal or sweep history and can't be deleted - archive it instead."),
        { status: 409 }
      )
    }
    throw new Error(`Failed to delete withdrawal destination: ${error.message}`)
  }
}

export { MAX_DESTINATIONS_PER_MERCHANT_RAIL }
