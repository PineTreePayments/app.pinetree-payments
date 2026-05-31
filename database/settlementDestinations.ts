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
  account_type: SettlementDestinationAccountType
  source: SettlementDestinationSource
  connected_provider: SettlementDestinationConnectedProvider | null
  external_account_name: string | null
  external_account_id: string | null
  institution_name: string | null
  last_verified_at: string | null
  created_at: string
  updated_at: string
}

export type SettlementDestinationAccountType =
  | "business_exchange"
  | "personal_exchange"
  | "external_wallet"
  | "other"

export type SettlementDestinationSource =
  | "manual"
  | "mesh"
  | "provider_import"
  | "unknown"

export type SettlementDestinationConnectedProvider =
  | "mesh"
  | "manual"

export type CreateSettlementDestinationInput = {
  merchantId: string
  label: string
  exchangeName: string
  asset: string
  network: string
  address: string
  memoOrTag?: string | null
  isDefault?: boolean
  accountType?: SettlementDestinationAccountType
  source?: SettlementDestinationSource
  connectedProvider?: SettlementDestinationConnectedProvider | null
  externalAccountName?: string | null
  externalAccountId?: string | null
  institutionName?: string | null
  lastVerifiedAt?: string | null
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
  accountType?: SettlementDestinationAccountType
  source?: SettlementDestinationSource
  connectedProvider?: SettlementDestinationConnectedProvider | null
  externalAccountName?: string | null
  externalAccountId?: string | null
  institutionName?: string | null
  lastVerifiedAt?: string | null
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
    account_type: normalizeAccountType(row.account_type),
    source: normalizeSource(row.source),
    connected_provider: normalizeConnectedProvider(row.connected_provider),
    external_account_name: row.external_account_name != null ? String(row.external_account_name) : null,
    external_account_id: row.external_account_id != null ? String(row.external_account_id) : null,
    institution_name: row.institution_name != null ? String(row.institution_name) : null,
    last_verified_at: row.last_verified_at != null ? String(row.last_verified_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  }
}

function normalizeAccountType(value: unknown): SettlementDestinationAccountType {
  const normalized = String(value || "").trim()
  if (normalized === "business_exchange" || normalized === "personal_exchange" || normalized === "external_wallet" || normalized === "other") {
    return normalized
  }
  return "other"
}

function normalizeSource(value: unknown): SettlementDestinationSource {
  const normalized = String(value || "").trim()
  if (normalized === "manual" || normalized === "mesh" || normalized === "provider_import" || normalized === "unknown") {
    return normalized
  }
  return "manual"
}

function normalizeConnectedProvider(value: unknown): SettlementDestinationConnectedProvider | null {
  const normalized = String(value || "").trim()
  if (normalized === "mesh" || normalized === "manual") return normalized
  return null
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
      account_type: input.accountType || "other",
      source: input.source || "manual",
      connected_provider: input.connectedProvider || "manual",
      external_account_name: input.externalAccountName?.trim() || null,
      external_account_id: input.externalAccountId?.trim() || null,
      institution_name: input.institutionName?.trim() || null,
      last_verified_at: input.lastVerifiedAt || null,
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
  if (input.accountType !== undefined) update.account_type = input.accountType
  if (input.source !== undefined) update.source = input.source
  if (input.connectedProvider !== undefined) update.connected_provider = input.connectedProvider
  if (input.externalAccountName !== undefined) update.external_account_name = input.externalAccountName?.trim() || null
  if (input.externalAccountId !== undefined) update.external_account_id = input.externalAccountId?.trim() || null
  if (input.institutionName !== undefined) update.institution_name = input.institutionName?.trim() || null
  if (input.lastVerifiedAt !== undefined) update.last_verified_at = input.lastVerifiedAt || null

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
