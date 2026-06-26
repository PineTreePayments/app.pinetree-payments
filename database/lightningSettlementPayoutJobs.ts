import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "lightning_settlement_payout_jobs"

export type LightningSettlementPayoutJobStatus =
  | "queued"
  | "processing"
  | "submitted"
  | "completed"
  | "failed"
  | "canceled"

export type LightningSettlementPayoutJob = {
  id: string
  merchant_id: string
  payment_id: string
  transaction_id: string | null
  speed_payment_id: string | null
  gross_amount_decimal: string
  fee_amount_decimal: string
  merchant_net_amount_decimal: string
  asset: string
  destination_address: string
  destination_type: string
  status: LightningSettlementPayoutJobStatus
  provider: string
  provider_payout_id: string | null
  provider_reference: string | null
  tx_hash: string | null
  attempt_count: number
  last_error: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

export type CreateLightningSettlementPayoutJobInput = {
  merchantId: string
  paymentId: string
  transactionId?: string | null
  speedPaymentId?: string | null
  grossAmountDecimal: string
  feeAmountDecimal: string
  merchantNetAmountDecimal: string
  asset?: string
  destinationAddress: string
  destinationType: string
  idempotencyKey: string
}

function normalize(row: Record<string, unknown>): LightningSettlementPayoutJob {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    payment_id: String(row.payment_id || ""),
    transaction_id: row.transaction_id != null ? String(row.transaction_id) : null,
    speed_payment_id: row.speed_payment_id != null ? String(row.speed_payment_id) : null,
    gross_amount_decimal: String(row.gross_amount_decimal || "0"),
    fee_amount_decimal: String(row.fee_amount_decimal || "0"),
    merchant_net_amount_decimal: String(row.merchant_net_amount_decimal || "0"),
    asset: String(row.asset || "BTC"),
    destination_address: String(row.destination_address || ""),
    destination_type: String(row.destination_type || ""),
    status: String(row.status || "queued") as LightningSettlementPayoutJobStatus,
    provider: String(row.provider || "speed"),
    provider_payout_id: row.provider_payout_id != null ? String(row.provider_payout_id) : null,
    provider_reference: row.provider_reference != null ? String(row.provider_reference) : null,
    tx_hash: row.tx_hash != null ? String(row.tx_hash) : null,
    attempt_count: Number(row.attempt_count || 0),
    last_error: row.last_error != null ? String(row.last_error) : null,
    idempotency_key: String(row.idempotency_key || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function getLightningSettlementPayoutJobByIdempotencyKey(
  idempotencyKey: string
): Promise<LightningSettlementPayoutJob | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (error) throw new Error(`Failed to load Lightning settlement payout job: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function createLightningSettlementPayoutJobIfMissing(
  input: CreateLightningSettlementPayoutJobInput
): Promise<LightningSettlementPayoutJob> {
  const existing = await getLightningSettlementPayoutJobByIdempotencyKey(input.idempotencyKey)
  if (existing) return existing

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      payment_id: input.paymentId,
      transaction_id: input.transactionId || null,
      speed_payment_id: input.speedPaymentId || null,
      gross_amount_decimal: input.grossAmountDecimal,
      fee_amount_decimal: input.feeAmountDecimal,
      merchant_net_amount_decimal: input.merchantNetAmountDecimal,
      asset: input.asset || "BTC",
      destination_address: input.destinationAddress,
      destination_type: input.destinationType,
      status: "queued",
      provider: "speed",
      idempotency_key: input.idempotencyKey,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    const raced = await getLightningSettlementPayoutJobByIdempotencyKey(input.idempotencyKey)
    if (raced) return raced
    throw new Error(`Failed to create Lightning settlement payout job: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export async function listQueuedLightningSettlementPayoutJobs(
  limit = 10
): Promise<LightningSettlementPayoutJob[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list Lightning settlement payout jobs: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function claimLightningSettlementPayoutJob(
  id: string
): Promise<LightningSettlementPayoutJob | null> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: "processing", updated_at: now })
    .eq("id", id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle()

  if (error || !data) return null
  const current = normalize(data as Record<string, unknown>)
  const { data: incremented, error: incrementError } = await supabase
    .from(TABLE)
    .update({ attempt_count: current.attempt_count + 1, updated_at: now })
    .eq("id", id)
    .select("*")
    .single()

  if (incrementError || !incremented) {
    throw new Error(`Failed to claim Lightning settlement payout job: ${incrementError?.message || "No data"}`)
  }
  return normalize(incremented as Record<string, unknown>)
}

export async function markLightningSettlementPayoutJobSubmitted(
  id: string,
  input: {
    providerPayoutId?: string | null
    providerReference?: string | null
    txHash?: string | null
  }
): Promise<LightningSettlementPayoutJob> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: "submitted",
      provider_payout_id: input.providerPayoutId || null,
      provider_reference: input.providerReference || null,
      tx_hash: input.txHash || null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to submit Lightning settlement payout job: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export async function markLightningSettlementPayoutJobFailed(
  id: string,
  message: string
): Promise<LightningSettlementPayoutJob> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: "failed",
      last_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(`Failed to fail Lightning settlement payout job: ${error?.message || "No data"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export async function listLightningSettlementPayoutJobsForMerchant(
  merchantId: string,
  limit = 25
): Promise<LightningSettlementPayoutJob[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list Lightning settlement payout history: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}
