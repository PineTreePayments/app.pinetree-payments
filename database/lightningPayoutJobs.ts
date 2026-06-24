import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "lightning_payout_jobs"

export type LightningPayoutJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "canceled"

export type LightningPayoutJob = {
  id: string
  merchant_id: string
  payment_id: string
  transaction_id: string | null
  provider: string
  settlement_mode: string
  speed_invoice_id: string | null
  speed_payment_id: string | null
  gross_amount_usd: number
  platform_fee_usd: number
  merchant_net_usd: number
  merchant_net_sats: number
  btc_payout_address: string
  btc_address_type: string | null
  status: LightningPayoutJobStatus
  speed_withdraw_request_id: string | null
  speed_payout_id: string | null
  txid: string | null
  provider_response_summary: Record<string, unknown>
  attempt_count: number
  last_error: string | null
  next_attempt_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type CreateLightningPayoutJobInput = {
  merchant_id: string
  payment_id: string
  transaction_id?: string | null
  provider: string
  settlement_mode: string
  speed_invoice_id?: string | null
  speed_payment_id?: string | null
  gross_amount_usd: number
  platform_fee_usd: number
  merchant_net_usd: number
  merchant_net_sats: number
  btc_payout_address?: string | null
  btc_address_type?: string | null
  status?: LightningPayoutJobStatus
}

export async function getLightningPayoutJobByPayment(input: {
  paymentId: string
  provider: string
  settlementMode: string
}): Promise<LightningPayoutJob | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("payment_id", input.paymentId)
    .eq("provider", input.provider)
    .eq("settlement_mode", input.settlementMode)
    .in("status", ["pending", "processing", "completed", "failed"])
    .maybeSingle()

  if (error || !data) return null
  return data as LightningPayoutJob
}

export async function createLightningPayoutJobIfMissing(
  input: CreateLightningPayoutJobInput
): Promise<LightningPayoutJob> {
  const existing = await getLightningPayoutJobByPayment({
    paymentId: input.payment_id,
    provider: input.provider,
    settlementMode: input.settlement_mode
  })
  if (existing) return existing

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ...input,
      status: input.status || "pending",
      btc_payout_address: input.btc_payout_address || "",
      btc_address_type: input.btc_address_type || null,
      created_at: now,
      updated_at: now
    })
    .select()
    .single()

  if (error || !data) {
    const raced = await getLightningPayoutJobByPayment({
      paymentId: input.payment_id,
      provider: input.provider,
      settlementMode: input.settlement_mode
    })
    if (raced) return raced
    throw new Error(`Failed to create Lightning payout job: ${error?.message || "unknown error"}`)
  }

  return data as LightningPayoutJob
}

export async function listPendingLightningPayoutJobs(limit = 25): Promise<LightningPayoutJob[]> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .in("status", ["pending", "failed"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list Lightning payout jobs: ${error.message}`)
  return (data || []) as LightningPayoutJob[]
}

export async function listLightningPayoutJobsForMerchant(
  merchantId: string,
  options: { limit?: number } = {}
): Promise<LightningPayoutJob[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 25)

  if (error) throw new Error(`Failed to list merchant Lightning payout jobs: ${error.message}`)
  return (data || []) as LightningPayoutJob[]
}

export async function claimLightningPayoutJob(jobId: string): Promise<LightningPayoutJob | null> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: "processing",
      updated_at: now
    })
    .eq("id", jobId)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle()

  if (error || !data) return null

  const current = data as LightningPayoutJob
  const { data: incremented, error: incrementError } = await supabase
    .from(TABLE)
    .update({
      attempt_count: Number(current.attempt_count || 0) + 1,
      updated_at: now
    })
    .eq("id", jobId)
    .select()
    .single()

  if (incrementError || !incremented) {
    throw new Error(`Failed to claim Lightning payout job: ${incrementError?.message || "unknown error"}`)
  }

  return incremented as LightningPayoutJob
}

export async function markLightningPayoutJobCompleted(
  jobId: string,
  params: {
    speedWithdrawRequestId?: string | null
    speedPayoutId?: string | null
    txid?: string | null
    providerResponseSummary?: Record<string, unknown>
  }
): Promise<LightningPayoutJob> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: "completed",
      speed_withdraw_request_id: params.speedWithdrawRequestId || null,
      speed_payout_id: params.speedPayoutId || null,
      txid: params.txid || null,
      provider_response_summary: params.providerResponseSummary || {},
      last_error: null,
      completed_at: now,
      updated_at: now
    })
    .eq("id", jobId)
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to complete Lightning payout job: ${error?.message || "unknown error"}`)
  }
  return data as LightningPayoutJob
}

export async function markLightningPayoutJobFailed(
  jobId: string,
  message: string,
  options?: { retryAfterMs?: number }
): Promise<LightningPayoutJob> {
  const retryAt = new Date(Date.now() + (options?.retryAfterMs ?? 5 * 60 * 1000)).toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: "failed",
      last_error: message.slice(0, 2000),
      next_attempt_at: retryAt,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId)
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to fail Lightning payout job: ${error?.message || "unknown error"}`)
  }
  return data as LightningPayoutJob
}
