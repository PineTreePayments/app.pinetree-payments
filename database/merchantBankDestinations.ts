/**
 * Merchant bank payout destinations - persistence.
 *
 * WHY A SEPARATE TABLE FROM merchant_withdrawal_destinations: that table is the
 * crypto address book. Its identity is (rail, asset, method, destination_address)
 * where the address is an on-chain address, and its rail check constraint admits
 * only base/solana/bitcoin. A US bank account has no on-chain address, so
 * storing one there would mean writing a provider identifier into an address
 * column and widening a constraint that exists to keep rails honest. Merchants
 * still see one Withdraw experience; only the storage differs.
 *
 * TENANT SAFETY: every read and write filters by merchant_id. The service-role
 * client bypasses RLS, so the merchant filter here IS the isolation boundary.
 *
 * SECURITY: the raw bank account number is NEVER written here. Only the
 * provider's external-account identifier, the masked last four the provider
 * returns, and non-sensitive display metadata are persisted.
 */

import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase
const TABLE = "merchant_bank_destinations"

export type BankDestinationStatus = "pending" | "active" | "archived"
export type BankAccountKind = "checking" | "savings"

export type MerchantBankDestination = {
  id: string
  merchant_id: string
  /** The regulated provider's external-account identifier. */
  provider_external_account_id: string | null
  provider: string
  label: string
  bank_name: string | null
  account_owner_name: string | null
  /** Masked last four exactly as the provider returned it. */
  account_last4: string | null
  account_kind: BankAccountKind | null
  currency: string
  country: string
  payment_rail: string
  status: BankDestinationStatus
  is_default: boolean
  provider_deactivation_reason: string | null
  last_used_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

function normalize(row: Record<string, unknown>): MerchantBankDestination {
  const status = String(row.status || "pending")
  const kind = String(row.account_kind || "")
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    provider_external_account_id:
      row.provider_external_account_id != null ? String(row.provider_external_account_id) : null,
    provider: String(row.provider || "bridge"),
    label: String(row.label || ""),
    bank_name: row.bank_name != null ? String(row.bank_name) : null,
    account_owner_name: row.account_owner_name != null ? String(row.account_owner_name) : null,
    account_last4: row.account_last4 != null ? String(row.account_last4) : null,
    account_kind: kind === "checking" || kind === "savings" ? kind : null,
    currency: String(row.currency || "usd"),
    country: String(row.country || "USA"),
    payment_rail: String(row.payment_rail || "ach"),
    status: status === "active" || status === "archived" ? status : "pending",
    is_default: row.is_default === true,
    provider_deactivation_reason:
      row.provider_deactivation_reason != null ? String(row.provider_deactivation_reason) : null,
    last_used_at: row.last_used_at != null ? String(row.last_used_at) : null,
    archived_at: row.archived_at != null ? String(row.archived_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function listMerchantBankDestinations(
  merchantId: string,
  options: { includeArchived?: boolean } = {}
): Promise<MerchantBankDestination[]> {
  let query = db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })

  if (!options.includeArchived) query = query.is("archived_at", null)

  const { data, error } = await query
  if (error) throw new Error(`Failed to list bank destinations: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function getMerchantBankDestination(
  merchantId: string,
  id: string
): Promise<MerchantBankDestination | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load bank destination: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

/**
 * Resolve the merchant that owns a provider external account.
 *
 * How a verified `external_account` webhook finds its tenant: by the stored
 * provider identifier only, never by anything the payload claims.
 */
export async function findBankDestinationByProviderId(
  providerExternalAccountId: string
): Promise<MerchantBankDestination | null> {
  const normalized = String(providerExternalAccountId || "").trim()
  if (!normalized) return null

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("provider_external_account_id", normalized)
    .maybeSingle()

  if (error) throw new Error(`Failed to resolve bank destination owner: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

/**
 * Reserve a PineTree row BEFORE the provider call.
 *
 * The row id is what seeds the provider idempotency key, so a retried
 * submission reuses the same key and can never register the same bank account
 * twice. The row starts `pending` and carries no provider id until the provider
 * confirms one.
 */
export async function reserveMerchantBankDestination(input: {
  merchantId: string
  label: string
  bankName: string | null
  accountOwnerName: string | null
  accountKind: BankAccountKind
  currency?: string
  country?: string
  paymentRail?: string
}): Promise<MerchantBankDestination> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      provider: "bridge",
      label: input.label.trim(),
      bank_name: input.bankName?.trim() || null,
      account_owner_name: input.accountOwnerName?.trim() || null,
      account_kind: input.accountKind,
      currency: (input.currency || "usd").toLowerCase(),
      country: (input.country || "USA").toUpperCase(),
      payment_rail: (input.paymentRail || "ach").toLowerCase(),
      status: "pending",
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to reserve bank destination: ${error?.message || "No data returned"}`)
  }
  return normalize(data as Record<string, unknown>)
}

/** Record the provider's confirmation: identifier, masked last four, status. */
export async function activateMerchantBankDestination(input: {
  merchantId: string
  id: string
  providerExternalAccountId: string
  bankName?: string | null
  accountOwnerName?: string | null
  accountLast4?: string | null
  accountKind?: BankAccountKind | null
  active: boolean
}): Promise<MerchantBankDestination> {
  const patch: Record<string, unknown> = {
    provider_external_account_id: input.providerExternalAccountId,
    status: input.active ? "active" : "pending",
    updated_at: new Date().toISOString(),
  }
  if (input.bankName !== undefined && input.bankName) patch.bank_name = input.bankName
  if (input.accountOwnerName !== undefined && input.accountOwnerName) {
    patch.account_owner_name = input.accountOwnerName
  }
  if (input.accountLast4 !== undefined && input.accountLast4) patch.account_last4 = input.accountLast4
  if (input.accountKind) patch.account_kind = input.accountKind

  const { data, error } = await db
    .from(TABLE)
    .update(patch)
    .eq("merchant_id", input.merchantId)
    .eq("id", input.id)
    .select("*")
    .maybeSingle()

  if (error) throw new Error(`Failed to activate bank destination: ${error.message}`)
  if (!data) throw Object.assign(new Error("Bank destination not found."), { status: 404 })
  return normalize(data as Record<string, unknown>)
}

/**
 * Apply a provider-reported state change (from a verified webhook or a sync).
 *
 * Never resurrects an archived destination: a merchant who removed a bank
 * account must not have it reappear because the provider re-reported it.
 */
export async function applyProviderBankDestinationState(input: {
  id: string
  active: boolean
  deactivationReason?: string | null
  accountLast4?: string | null
}): Promise<void> {
  const patch: Record<string, unknown> = {
    status: input.active ? "active" : "pending",
    provider_deactivation_reason: input.deactivationReason ?? null,
    updated_at: new Date().toISOString(),
  }
  if (input.accountLast4) patch.account_last4 = input.accountLast4

  const { error } = await db
    .from(TABLE)
    .update(patch)
    .eq("id", input.id)
    .is("archived_at", null)

  if (error) throw new Error(`Failed to apply bank destination state: ${error.message}`)
}

/**
 * Archive rather than delete.
 *
 * Withdrawal history references the destination, and the provider's own
 * semantics are deactivate-not-delete, so PineTree mirrors both.
 */
export async function archiveMerchantBankDestination(
  merchantId: string,
  id: string,
  reason?: string | null
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db
    .from(TABLE)
    .update({
      archived_at: now,
      status: "archived",
      is_default: false,
      provider_deactivation_reason: reason || null,
      updated_at: now,
    })
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) throw new Error(`Failed to archive bank destination: ${error.message}`)
}

export async function markBankDestinationUsed(merchantId: string, id: string): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq("merchant_id", merchantId)
    .eq("id", id)

  if (error) throw new Error(`Failed to update bank destination usage: ${error.message}`)
}
