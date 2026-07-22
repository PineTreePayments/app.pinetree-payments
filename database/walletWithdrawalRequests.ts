import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase
const TABLE = "wallet_withdrawal_requests"

function isMissingWithdrawalLifecycleColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
      (
        error.code === "PGRST204" ||
        /submitted_at|confirmed_at|failed_at|provider_request_id/i.test(error.message || "")
      )
  )
}

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

export type WalletWithdrawalSource = "manual" | "saved_address" | "automatic_sweep"

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
  source: WalletWithdrawalSource
  destination_id: string | null
  destination_snapshot: Record<string, unknown> | null
  idempotency_key: string | null
  fee_amount_decimal: string | null
  native_fee_asset: string | null
  error_code: string | null
  provider_request_id: string | null
  submitted_at: string | null
  confirmed_at: string | null
  failed_at: string | null
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
  errorCode?: string | null
  providerRequestId?: string | null
  submittedAt?: string | null
  confirmedAt?: string | null
  failedAt?: string | null
}

export type FindOpenUnsignedWalletWithdrawalInput = {
  merchantId: string
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
}

function normalize(row: Record<string, unknown>): WalletWithdrawalRequestRecord {
  const reviewPayload = row.review_payload
  const unsignedPayload = row.unsigned_transaction_payload
  const signedPayload = row.signed_payload
  const destinationSnapshot = row.destination_snapshot
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
    source: (row.source === "saved_address" || row.source === "automatic_sweep" ? row.source : "manual") as WalletWithdrawalSource,
    destination_id: row.destination_id != null ? String(row.destination_id) : null,
    destination_snapshot:
      typeof destinationSnapshot === "object" && destinationSnapshot !== null && !Array.isArray(destinationSnapshot)
        ? destinationSnapshot as Record<string, unknown>
        : null,
    idempotency_key: row.idempotency_key != null ? String(row.idempotency_key) : null,
    fee_amount_decimal: row.fee_amount_decimal != null ? String(row.fee_amount_decimal) : null,
    native_fee_asset: row.native_fee_asset != null ? String(row.native_fee_asset) : null,
    error_code: row.error_code != null ? String(row.error_code) : null,
    provider_request_id: row.provider_request_id != null ? String(row.provider_request_id) : null,
    submitted_at: row.submitted_at != null ? String(row.submitted_at) : null,
    confirmed_at: row.confirmed_at != null ? String(row.confirmed_at) : null,
    failed_at: row.failed_at != null ? String(row.failed_at) : null,
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
  if (input.errorCode !== undefined) update.error_code = input.errorCode
  if (input.providerRequestId !== undefined) update.provider_request_id = input.providerRequestId
  if (input.submittedAt !== undefined) update.submitted_at = input.submittedAt
  if (input.confirmedAt !== undefined) update.confirmed_at = input.confirmedAt
  if (input.failedAt !== undefined) update.failed_at = input.failedAt

  let { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .single()

  if (isMissingWithdrawalLifecycleColumn(error)) {
    const fallback = { ...update }
    delete fallback.provider_request_id
    delete fallback.submitted_at
    delete fallback.confirmed_at
    delete fallback.failed_at
    ;({ data, error } = await db
      .from(TABLE)
      .update(fallback)
      .eq("merchant_id", merchantId)
      .eq("id", id)
      .select("*")
      .single())
  }

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

const ACTIVITY_STATUSES: WalletWithdrawalStatus[] = ["review_required", "pending", "processing", "confirmed", "failed", "canceled", "blocked"]

export async function findOpenUnsignedWalletWithdrawalReview(
  input: FindOpenUnsignedWalletWithdrawalInput
): Promise<WalletWithdrawalRequestRecord | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", input.merchantId)
    .eq("rail", input.rail)
    .eq("asset", input.asset)
    .eq("destination_address", input.destinationAddress.trim())
    .eq("amount_decimal", input.amountDecimal.trim())
    .in("status", ["review_required", "pending"])
    .is("tx_hash", null)
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) throw new Error(`Failed to find open wallet withdrawal review: ${error.message}`)
  const row = data?.[0]
  return row ? normalize(row as Record<string, unknown>) : null
}

export async function cancelStaleUnsignedWithdrawalReviews(
  merchantId: string,
  options: { olderThanMs?: number; now?: Date } = {}
): Promise<{ canceled: number }> {
  const olderThanMs = options.olderThanMs ?? 30 * 60 * 1000
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - olderThanMs).toISOString()
  const { data, error } = await db
    .from(TABLE)
    .update({
      status: "canceled",
      error_message: "Unsigned withdrawal review expired.",
      updated_at: now.toISOString(),
    })
    .eq("merchant_id", merchantId)
    .in("status", ["review_required", "pending"])
    .is("tx_hash", null)
    .lt("created_at", cutoff)
    .select("id")

  if (error) throw new Error(`Failed to clean stale wallet withdrawal reviews: ${error.message}`)
  return { canceled: data?.length ?? 0 }
}

function isMeaningfulActivityWithdrawal(row: WalletWithdrawalRequestRecord, activeUnsignedId: string | null) {
  if (row.status === "processing") return Boolean(row.tx_hash)
  if (row.status === "confirmed") return true
  if (row.status === "failed") return Boolean(row.tx_hash)
  if (row.status === "review_required" || row.status === "pending") {
    return !row.tx_hash && row.id === activeUnsignedId
  }
  return false
}

export async function listRecentWalletWithdrawalsForActivity(
  merchantId: string,
  limit: number
): Promise<WalletWithdrawalRequestRecord[]> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .in("status", ACTIVITY_STATUSES)
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 3, limit))

  if (error) throw new Error(`Failed to list wallet withdrawals for activity: ${error.message}`)
  const rows = (data || []).map((row) => normalize(row as Record<string, unknown>))
  const activeUnsigned = rows.find((row) =>
    (row.status === "review_required" || row.status === "pending") && !row.tx_hash
  )
  return rows
    .filter((row) => isMeaningfulActivityWithdrawal(row, activeUnsigned?.id ?? null))
    .slice(0, limit)
}

export async function listProcessingWithdrawalsForReconciliation(
  limit: number
): Promise<WalletWithdrawalRequestRecord[]> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("status", "processing")
    .in("rail", ["base", "solana"])
    .or("tx_hash.not.is.null,provider_reference.not.is.null")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list processing withdrawals for reconciliation: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

/**
 * Bitcoin/Lightning withdrawals executed via Speed's Instant Send never get
 * an on-chain tx_hash (Lightning is off-chain, and Speed's onchain sends are
 * tracked by provider_reference), so they need a dedicated reconciliation
 * query separate from listProcessingWithdrawalsForReconciliation above.
 */
export async function listProcessingBitcoinWithdrawalsForReconciliation(
  limit: number
): Promise<WalletWithdrawalRequestRecord[]> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("status", "processing")
    .eq("rail", "bitcoin")
    .not("provider_reference", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list processing Bitcoin withdrawals for reconciliation: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

/**
 * Prevents a BOLT11 invoice from being reused across withdrawals: a prior
 * attempt only blocks reuse while it is in-flight or already completed.
 * A failed/canceled/blocked prior attempt never paid the invoice, so it must
 * not block a fresh attempt at the same invoice.
 */
export async function findInFlightOrCompletedWithdrawalForDestination(
  merchantId: string,
  destinationAddress: string,
  excludeId?: string | null
): Promise<WalletWithdrawalRequestRecord | null> {
  let query = db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("rail", "bitcoin")
    .eq("destination_address", destinationAddress.trim().toLowerCase())
    .in("status", ["pending", "processing", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(1)

  if (excludeId) query = query.neq("id", excludeId)

  const { data, error } = await query
  if (error) throw new Error(`Failed to check destination reuse: ${error.message}`)
  const row = data?.[0]
  return row ? normalize(row as Record<string, unknown>) : null
}

/**
 * Stamps the canonical-dispatcher fields (source/destination_id/snapshot/
 * idempotency/fee) onto an existing review row without going through
 * updateWalletWithdrawalRequest's UpdateWalletWithdrawalRequestInput shape -
 * kept as a separate, narrow function so the hot prepare/submit path's
 * existing input contract never needs to widen for this.
 */
export async function updateWalletWithdrawalRequestCanonicalFields(
  merchantId: string,
  id: string,
  input: {
    source: WalletWithdrawalSource
    destinationId?: string | null
    destinationSnapshot?: Record<string, unknown> | null
    idempotencyKey?: string | null
    feeAmountDecimal?: string | null
    nativeFeeAsset?: string | null
  }
): Promise<WalletWithdrawalRequestRecord> {
  const update: Record<string, unknown> = {
    source: input.source,
    updated_at: new Date().toISOString(),
  }
  if (input.destinationId !== undefined) update.destination_id = input.destinationId
  if (input.destinationSnapshot !== undefined) update.destination_snapshot = input.destinationSnapshot
  if (input.idempotencyKey !== undefined) update.idempotency_key = input.idempotencyKey
  if (input.feeAmountDecimal !== undefined) update.fee_amount_decimal = input.feeAmountDecimal
  if (input.nativeFeeAsset !== undefined) update.native_fee_asset = input.nativeFeeAsset

  const { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to stamp canonical withdrawal fields: ${error?.message || "Not found"}`)
  }
  return normalize(data as Record<string, unknown>)
}

/**
 * Sums amount_decimal for withdrawals not yet in a terminal state (pending
 * or processing) for a given rail/asset - used by the Max-withdrawal
 * calculation so an in-flight withdrawal's amount is never double-counted as
 * still-spendable.
 */
export async function sumPendingWalletWithdrawalAmount(
  merchantId: string,
  rail: WalletWithdrawalRail,
  asset: WalletWithdrawalAsset
): Promise<number> {
  const { data, error } = await db
    .from(TABLE)
    .select("amount_decimal")
    .eq("merchant_id", merchantId)
    .eq("rail", rail)
    .eq("asset", asset)
    .in("status", ["pending", "processing"])

  if (error) throw new Error(`Failed to sum pending wallet withdrawals: ${error.message}`)
  return (data || []).reduce((total, row) => total + (Number(row.amount_decimal) || 0), 0)
}

export async function findWalletWithdrawalRequestByIdempotencyKey(
  merchantId: string,
  idempotencyKey: string
): Promise<WalletWithdrawalRequestRecord | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (error) throw new Error(`Failed to look up wallet withdrawal by idempotency key: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}
