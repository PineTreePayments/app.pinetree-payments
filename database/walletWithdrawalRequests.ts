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
  unsigned_transaction_payload: Record<string, unknown> | null
  signed_payload: Record<string, unknown> | null
  approval_method: string | null
  chain_id: string | null
  token_contract: string | null
  token_mint: string | null
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
  unsignedTransactionPayload?: Record<string, unknown> | null
  signedPayload?: Record<string, unknown> | null
  approvalMethod?: string | null
  chainId?: string | null
  tokenContract?: string | null
  tokenMint?: string | null
  reviewPayload?: Record<string, unknown>
  errorMessage?: string | null
}

export type UpdateWalletWithdrawalRequestInput = {
  status?: WalletWithdrawalStatus
  provider?: string | null
  providerReference?: string | null
  txHash?: string | null
  unsignedTransactionPayload?: Record<string, unknown> | null
  signedPayload?: Record<string, unknown> | null
  approvalMethod?: string | null
  chainId?: string | null
  tokenContract?: string | null
  tokenMint?: string | null
  reviewPayload?: Record<string, unknown>
  errorMessage?: string | null
}

function normalize(row: Record<string, unknown>): WalletWithdrawalRequestRecord {
  const reviewPayload = row.review_payload
  const unsignedPayload = row.unsigned_transaction_payload
  const signedPayload = row.signed_payload
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
    unsigned_transaction_payload:
      typeof unsignedPayload === "object" && unsignedPayload !== null && !Array.isArray(unsignedPayload)
        ? unsignedPayload as Record<string, unknown>
        : null,
    signed_payload:
      typeof signedPayload === "object" && signedPayload !== null && !Array.isArray(signedPayload)
        ? signedPayload as Record<string, unknown>
        : null,
    approval_method: row.approval_method != null ? String(row.approval_method) : null,
    chain_id: row.chain_id != null ? String(row.chain_id) : null,
    token_contract: row.token_contract != null ? String(row.token_contract) : null,
    token_mint: row.token_mint != null ? String(row.token_mint) : null,
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
      unsigned_transaction_payload: input.unsignedTransactionPayload || null,
      signed_payload: input.signedPayload || null,
      approval_method: input.approvalMethod || null,
      chain_id: input.chainId || null,
      token_contract: input.tokenContract || null,
      token_mint: input.tokenMint || null,
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
  if (input.unsignedTransactionPayload !== undefined) update.unsigned_transaction_payload = input.unsignedTransactionPayload
  if (input.signedPayload !== undefined) update.signed_payload = input.signedPayload
  if (input.approvalMethod !== undefined) update.approval_method = input.approvalMethod
  if (input.chainId !== undefined) update.chain_id = input.chainId
  if (input.tokenContract !== undefined) update.token_contract = input.tokenContract
  if (input.tokenMint !== undefined) update.token_mint = input.tokenMint
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
