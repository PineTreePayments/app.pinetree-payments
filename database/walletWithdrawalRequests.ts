import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase
const TABLE = "wallet_withdrawal_requests"

export type WalletWithdrawalRail = "base" | "solana" | "bitcoin"
export type WalletWithdrawalAsset = "ETH" | "USDC" | "SOL" | "BTC"
export type WalletWithdrawalStatus =
  | "draft"
  | "review_required"
  | "blocked"
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "canceled"

export type WalletWithdrawalRequestRecord = {
  id: string
  merchant_id: string
  wallet_profile_id: string | null
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destination_address: string
  amount_decimal: string
  status: WalletWithdrawalStatus
  provider: string | null
  provider_reference: string | null
  tx_hash: string | null
  review_payload: Record<string, unknown>
  error_message: string | null
  created_at: string
  updated_at: string
}

export type CreateWalletWithdrawalRequestInput = {
  merchantId: string
  walletProfileId?: string | null
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  status?: WalletWithdrawalStatus
  provider?: string | null
  providerReference?: string | null
  txHash?: string | null
  reviewPayload?: Record<string, unknown>
  errorMessage?: string | null
}

export type UpdateWalletWithdrawalRequestInput = {
  status?: WalletWithdrawalStatus
  provider?: string | null
  providerReference?: string | null
  txHash?: string | null
  reviewPayload?: Record<string, unknown>
  errorMessage?: string | null
}

function normalize(row: Record<string, unknown>): WalletWithdrawalRequestRecord {
  const reviewPayload = row.review_payload
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    wallet_profile_id: row.wallet_profile_id != null ? String(row.wallet_profile_id) : null,
    rail: String(row.rail || "base") as WalletWithdrawalRail,
    asset: String(row.asset || "ETH") as WalletWithdrawalAsset,
    destination_address: String(row.destination_address || ""),
    amount_decimal: String(row.amount_decimal ?? row.amount ?? "0"),
    status: String(row.status || "draft") as WalletWithdrawalStatus,
    provider: row.provider != null ? String(row.provider) : null,
    provider_reference: row.provider_reference != null ? String(row.provider_reference) : null,
    tx_hash: row.tx_hash != null ? String(row.tx_hash) : null,
    review_payload:
      typeof reviewPayload === "object" && reviewPayload !== null && !Array.isArray(reviewPayload)
        ? reviewPayload as Record<string, unknown>
        : {},
    error_message: row.error_message != null ? String(row.error_message) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function createWalletWithdrawalRequest(
  input: CreateWalletWithdrawalRequestInput
): Promise<WalletWithdrawalRequestRecord> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      wallet_profile_id: input.walletProfileId || null,
      rail: input.rail,
      asset: input.asset,
      destination_address: input.destinationAddress.trim(),
      amount_decimal: input.amountDecimal.trim(),
      status: input.status || "review_required",
      provider: input.provider || null,
      provider_reference: input.providerReference || null,
      tx_hash: input.txHash || null,
      review_payload: input.reviewPayload || {},
      error_message: input.errorMessage || null,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create wallet withdrawal request: ${error?.message || "No data"}`)
  }

  return normalize(data as Record<string, unknown>)
}

export async function updateWalletWithdrawalRequest(
  merchantId: string,
  id: string,
  input: UpdateWalletWithdrawalRequestInput
): Promise<WalletWithdrawalRequestRecord> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (input.status !== undefined) update.status = input.status
  if (input.provider !== undefined) update.provider = input.provider
  if (input.providerReference !== undefined) update.provider_reference = input.providerReference
  if (input.txHash !== undefined) update.tx_hash = input.txHash
  if (input.reviewPayload !== undefined) update.review_payload = input.reviewPayload
  if (input.errorMessage !== undefined) update.error_message = input.errorMessage

  const { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to update wallet withdrawal request: ${error?.message || "Not found"}`)
  }

  return normalize(data as Record<string, unknown>)
}

export async function getWalletWithdrawalRequest(
  merchantId: string,
  id: string
): Promise<WalletWithdrawalRequestRecord | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to get wallet withdrawal request: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}
