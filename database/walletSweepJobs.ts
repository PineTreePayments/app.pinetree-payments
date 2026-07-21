import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
import type { SweepRail, SweepAsset } from "./walletSweepRules"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "wallet_sweep_jobs"
const EVENTS_TABLE = "wallet_sweep_events"

export type SweepJobStatus =
  | "QUEUED"
  | "AWAITING_FINALITY"
  | "AWAITING_GAS"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED"

export type SweepJobTriggerKind = "payment_confirmed" | "threshold" | "daily" | "manual_test"
export type SweepWithdrawalSourceTable = "wallet_withdrawal_requests" | "merchant_wallet_operations"

export type WalletSweepJob = {
  id: string
  rule_id: string
  merchant_id: string
  rail: SweepRail
  asset: SweepAsset
  status: SweepJobStatus
  amount_decimal: string
  idempotency_key: string
  trigger_kind: SweepJobTriggerKind
  trigger_payment_id: string | null
  trigger_balance_snapshot: Record<string, unknown> | null
  withdrawal_source_table: SweepWithdrawalSourceTable | null
  withdrawal_id: string | null
  attempt_count: number
  claimed_at: string | null
  not_before: string
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export type CreateSweepJobInput = {
  ruleId: string
  merchantId: string
  rail: SweepRail
  asset: SweepAsset
  amountDecimal: string
  idempotencyKey: string
  triggerKind: SweepJobTriggerKind
  triggerPaymentId?: string | null
  triggerBalanceSnapshot?: Record<string, unknown> | null
  notBefore?: string
}

function normalize(row: Record<string, unknown>): WalletSweepJob {
  return {
    id: String(row.id || ""),
    rule_id: String(row.rule_id || ""),
    merchant_id: String(row.merchant_id || ""),
    rail: String(row.rail || "base") as SweepRail,
    asset: String(row.asset || "ETH") as SweepAsset,
    status: String(row.status || "QUEUED") as SweepJobStatus,
    amount_decimal: String(row.amount_decimal ?? "0"),
    idempotency_key: String(row.idempotency_key || ""),
    trigger_kind: String(row.trigger_kind || "threshold") as SweepJobTriggerKind,
    trigger_payment_id: row.trigger_payment_id != null ? String(row.trigger_payment_id) : null,
    trigger_balance_snapshot: (row.trigger_balance_snapshot as Record<string, unknown> | null) ?? null,
    withdrawal_source_table: row.withdrawal_source_table != null ? (String(row.withdrawal_source_table) as SweepWithdrawalSourceTable) : null,
    withdrawal_id: row.withdrawal_id != null ? String(row.withdrawal_id) : null,
    attempt_count: Number(row.attempt_count ?? 0),
    claimed_at: row.claimed_at != null ? String(row.claimed_at) : null,
    not_before: String(row.not_before || ""),
    failure_reason: row.failure_reason != null ? String(row.failure_reason) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

/**
 * Creates a new QUEUED job, or returns the existing one for the same
 * (merchant_id, idempotency_key) pair unchanged - callers must always treat
 * the `created` flag as authoritative for whether this is a fresh queue
 * entry. This is the idempotency guarantee that makes it safe to call sweep
 * eligibility evaluation redundantly from more than one payment-confirmation
 * code path, cron retries, or webhook retries.
 */
export async function createSweepJob(
  input: CreateSweepJobInput
): Promise<{ job: WalletSweepJob; created: boolean }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      rule_id: input.ruleId,
      merchant_id: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      amount_decimal: input.amountDecimal,
      idempotency_key: input.idempotencyKey,
      trigger_kind: input.triggerKind,
      trigger_payment_id: input.triggerPaymentId ?? null,
      trigger_balance_snapshot: input.triggerBalanceSnapshot ?? null,
      not_before: input.notBefore ?? new Date().toISOString(),
    })
    .select("*")
    .single()

  if (!error) return { job: normalize(data as Record<string, unknown>), created: true }

  if (error.code !== "23505") {
    throw new Error(`Failed to create sweep job: ${error.message}`)
  }
  const existing = await getSweepJobByIdempotencyKey(input.merchantId, input.idempotencyKey)
  if (!existing) throw new Error("Failed to load existing sweep job after idempotency conflict")
  return { job: existing, created: false }
}

export async function getSweepJobByIdempotencyKey(
  merchantId: string,
  idempotencyKey: string
): Promise<WalletSweepJob | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (error) throw new Error(`Failed to load sweep job: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function getSweepJobForMerchant(merchantId: string, id: string): Promise<WalletSweepJob | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load sweep job: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function listSweepJobsForMerchant(merchantId: string, limit = 25): Promise<WalletSweepJob[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list sweep jobs: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

/**
 * QUEUED (or AWAITING_GAS, now potentially fundable) Base/Solana jobs for a
 * merchant - used by the client-side auto-continue hook so the merchant's
 * next authenticated Wallet session can complete the browser-signed
 * withdrawal for a job the cron already evaluated as eligible. Bitcoin jobs
 * never appear here since they execute unattended server-side.
 */
export async function listPendingClientSweepJobs(merchantId: string): Promise<WalletSweepJob[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .in("rail", ["base", "solana"])
    .in("status", ["QUEUED", "AWAITING_GAS"])
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Failed to list pending client sweep jobs: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function updateSweepJob(
  id: string,
  patch: Partial<{
    status: SweepJobStatus
    withdrawalSourceTable: SweepWithdrawalSourceTable | null
    withdrawalId: string | null
    failureReason: string | null
    notBefore: string
  }>
): Promise<WalletSweepJob> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status !== undefined) update.status = patch.status
  if (patch.withdrawalSourceTable !== undefined) update.withdrawal_source_table = patch.withdrawalSourceTable
  if (patch.withdrawalId !== undefined) update.withdrawal_id = patch.withdrawalId
  if (patch.failureReason !== undefined) update.failure_reason = patch.failureReason
  if (patch.notBefore !== undefined) update.not_before = patch.notBefore

  const { data, error } = await supabase.from(TABLE).update(update).eq("id", id).select("*").single()
  if (error || !data) throw new Error(`Failed to update sweep job: ${error?.message || "not found"}`)
  return normalize(data as Record<string, unknown>)
}

export async function insertSweepEvent(input: {
  jobId: string
  fromStatus: string | null
  toStatus: string
  reason?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabase.from(EVENTS_TABLE).insert({
    job_id: input.jobId,
    from_status: input.fromStatus,
    to_status: input.toStatus,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) console.warn("[walletSweepJobs] failed to record sweep event:", error.message)
}

/**
 * Atomically claims up to `limit` QUEUED jobs (flips them to PROCESSING),
 * via the claim_wallet_sweep_jobs Postgres function
 * (database/migrations/20260721_create_claim_wallet_sweep_jobs_fn.sql) -
 * the only way to get real row-locking (SKIP LOCKED) semantics through this
 * repo's PostgREST-only DB access, so two overlapping cron invocations can
 * never claim the same job.
 */
export async function claimWalletSweepJobs(limit: number): Promise<WalletSweepJob[]> {
  const { data, error } = await supabase.rpc("claim_wallet_sweep_jobs", { p_limit: limit })
  if (error) throw new Error(`Failed to claim sweep jobs: ${error.message}`)
  return ((data as Record<string, unknown>[]) || []).map(normalize)
}

/**
 * Reclaims jobs stuck PROCESSING past stalledAfterSeconds (a crashed/timed-
 * out cron invocation), returning the number reset.
 */
export async function resetStalledWalletSweepJobs(stalledAfterSeconds = 600): Promise<number> {
  const { data, error } = await supabase.rpc("reset_stalled_wallet_sweep_jobs", {
    p_stalled_after_seconds: stalledAfterSeconds,
  })
  if (error) throw new Error(`Failed to reset stalled sweep jobs: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Sums amount_decimal of QUEUED/PROCESSING jobs for a merchant/rail/asset -
 * these represent funds already earmarked by automation and must be
 * excluded from a fresh Max-withdrawal or threshold-eligibility calculation
 * so the same balance is never double-committed.
 */
export async function sumQueuedSweepAmount(
  merchantId: string,
  rail: SweepRail,
  asset: SweepAsset
): Promise<number> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("amount_decimal")
    .eq("merchant_id", merchantId)
    .eq("rail", rail)
    .eq("asset", asset)
    .in("status", ["QUEUED", "AWAITING_FINALITY", "AWAITING_GAS", "PROCESSING"])

  if (error) throw new Error(`Failed to sum queued sweep amount: ${error.message}`)
  return (data || []).reduce((total, row) => total + (Number(row.amount_decimal) || 0), 0)
}

/**
 * Sums amount_decimal of jobs that reached CONFIRMED today (UTC) for a
 * rule - the max_daily_sweep_usd safety-cap check reads this before queuing
 * a new job for the same rule.
 */
export async function sumConfirmedSweepAmountTodayForRule(ruleId: string): Promise<number> {
  const startOfDayUtc = new Date()
  startOfDayUtc.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from(TABLE)
    .select("amount_decimal")
    .eq("rule_id", ruleId)
    .eq("status", "CONFIRMED")
    .gte("updated_at", startOfDayUtc.toISOString())

  if (error) throw new Error(`Failed to sum confirmed sweep amount: ${error.message}`)
  return (data || []).reduce((total, row) => total + (Number(row.amount_decimal) || 0), 0)
}
