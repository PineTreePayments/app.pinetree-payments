import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

const TABLE = "settlement_withdrawals"

export type SettlementWithdrawalStatus =
  | "DRAFT"
  | "PREPARED"
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"

export type SettlementWithdrawalRecord = {
  id: string
  merchant_id: string
  wallet_id: string | null
  settlement_destination_id: string | null
  movement_type: string
  destination_kind: string | null
  destination_label: string
  exchange_name: string
  asset: string
  network: string
  amount: number
  destination_address: string
  memo_or_tag: string | null
  status: SettlementWithdrawalStatus
  tx_hash: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  confirmed_at: string | null
}

export type CreateSettlementWithdrawalInput = {
  merchantId: string
  walletId?: string | null
  settlementDestinationId?: string | null
  movementType?: string
  destinationKind?: string | null
  destinationLabel: string
  exchangeName: string
  asset: string
  network: string
  amount: number
  destinationAddress: string
  memoOrTag?: string | null
  status?: SettlementWithdrawalStatus
}

function normalize(row: Record<string, unknown>): SettlementWithdrawalRecord {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    wallet_id: row.wallet_id != null ? String(row.wallet_id) : null,
    settlement_destination_id: row.settlement_destination_id != null ? String(row.settlement_destination_id) : null,
    movement_type: String(row.movement_type || "saved_destination_withdrawal"),
    destination_kind: row.destination_kind != null ? String(row.destination_kind) : null,
    destination_label: String(row.destination_label || ""),
    exchange_name: String(row.exchange_name || ""),
    asset: String(row.asset || ""),
    network: String(row.network || ""),
    amount: Number(row.amount ?? 0),
    destination_address: String(row.destination_address || ""),
    memo_or_tag: row.memo_or_tag != null ? String(row.memo_or_tag) : null,
    status: String(row.status || "DRAFT") as SettlementWithdrawalStatus,
    tx_hash: row.tx_hash != null ? String(row.tx_hash) : null,
    failure_reason: row.failure_reason != null ? String(row.failure_reason) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    submitted_at: row.submitted_at != null ? String(row.submitted_at) : null,
    confirmed_at: row.confirmed_at != null ? String(row.confirmed_at) : null
  }
}

export async function createSettlementWithdrawal(
  input: CreateSettlementWithdrawalInput
): Promise<SettlementWithdrawalRecord> {
  const now = new Date().toISOString()

  const { data, error } = await db
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      wallet_id: input.walletId || null,
      settlement_destination_id: input.settlementDestinationId || null,
      movement_type: input.movementType || "saved_destination_withdrawal",
      destination_kind: input.destinationKind || "saved_destination",
      destination_label: input.destinationLabel,
      exchange_name: input.exchangeName,
      asset: input.asset.trim().toUpperCase(),
      network: input.network.trim().toLowerCase(),
      amount: input.amount,
      destination_address: input.destinationAddress.trim(),
      memo_or_tag: input.memoOrTag?.trim() || null,
      status: input.status || "PREPARED",
      updated_at: now
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create settlement withdrawal: ${error?.message || "No data"}`)
  }

  return normalize(data as Record<string, unknown>)
}

export async function getSettlementWithdrawalByTxHash(
  merchantId: string,
  txHash: string
): Promise<SettlementWithdrawalRecord | null> {
  const cleanHash = txHash.trim()
  if (!cleanHash) return null

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("tx_hash", cleanHash)
    .maybeSingle()

  if (error) throw new Error(`Failed to get settlement withdrawal by tx hash: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function getSettlementWithdrawal(
  merchantId: string,
  id: string
): Promise<SettlementWithdrawalRecord | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to get settlement withdrawal: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function updateSettlementWithdrawalStatus(
  merchantId: string,
  id: string,
  status: SettlementWithdrawalStatus,
  opts?: {
    txHash?: string | null
    failureReason?: string | null
    submittedAt?: string | null
    confirmedAt?: string | null
  }
): Promise<SettlementWithdrawalRecord> {
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status, updated_at: now }

  if (opts?.txHash !== undefined)       update.tx_hash        = opts.txHash
  if (opts?.failureReason !== undefined) update.failure_reason = opts.failureReason
  if (opts?.submittedAt !== undefined)   update.submitted_at   = opts.submittedAt
  if (opts?.confirmedAt !== undefined)   update.confirmed_at   = opts.confirmedAt

  const { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to update settlement withdrawal: ${error?.message || "Not found"}`)
  }

  return normalize(data as Record<string, unknown>)
}

export async function listSettlementWithdrawalsForMerchant(
  merchantId: string,
  options?: { limit?: number; destinationId?: string }
): Promise<SettlementWithdrawalRecord[]> {
  const limit = Math.min(Math.max(Number(options?.limit ?? 20) || 20, 1), 50)

  let query = db
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (options?.destinationId) {
    query = query.eq("settlement_destination_id", options.destinationId)
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to list settlement withdrawals: ${error.message}`)
  return ((data || []) as Record<string, unknown>[]).map(normalize)
}
