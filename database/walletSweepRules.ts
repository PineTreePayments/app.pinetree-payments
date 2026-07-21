import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon
const TABLE = "wallet_sweep_rules"

export type SweepRail = "base" | "solana" | "bitcoin"
export type SweepAsset = "ETH" | "USDC" | "SOL" | "BTC"
export type SweepMode = "manual" | "threshold" | "daily" | "per_payment"

export type WalletSweepRule = {
  id: string
  merchant_id: string
  rail: SweepRail
  asset: SweepAsset
  destination_id: string
  is_enabled: boolean
  mode: SweepMode
  threshold_amount_decimal: string | null
  scheduled_time_utc: string | null
  min_remaining_reserve_decimal: string
  max_daily_sweep_usd: number | null
  acknowledgment_text: string
  acknowledged_at: string
  last_evaluated_at: string | null
  last_executed_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  last_failure_reason: string | null
  created_at: string
  updated_at: string
}

export type CreateSweepRuleInput = {
  merchantId: string
  rail: SweepRail
  asset: SweepAsset
  destinationId: string
  mode: SweepMode
  thresholdAmountDecimal?: string | null
  scheduledTimeUtc?: string | null
  minRemainingReserveDecimal?: string
  maxDailySweepUsd?: number | null
  acknowledgmentText: string
  isEnabled?: boolean
}

export type UpdateSweepRuleInput = {
  isEnabled?: boolean
  mode?: SweepMode
  thresholdAmountDecimal?: string | null
  scheduledTimeUtc?: string | null
  minRemainingReserveDecimal?: string
  maxDailySweepUsd?: number | null
  acknowledgmentText?: string
  acknowledgedAt?: string
}

function normalize(row: Record<string, unknown>): WalletSweepRule {
  return {
    id: String(row.id || ""),
    merchant_id: String(row.merchant_id || ""),
    rail: String(row.rail || "base") as SweepRail,
    asset: String(row.asset || "ETH") as SweepAsset,
    destination_id: String(row.destination_id || ""),
    is_enabled: Boolean(row.is_enabled),
    mode: String(row.mode || "manual") as SweepMode,
    threshold_amount_decimal: row.threshold_amount_decimal != null ? String(row.threshold_amount_decimal) : null,
    scheduled_time_utc: row.scheduled_time_utc != null ? String(row.scheduled_time_utc) : null,
    min_remaining_reserve_decimal: String(row.min_remaining_reserve_decimal ?? "0"),
    max_daily_sweep_usd: row.max_daily_sweep_usd != null ? Number(row.max_daily_sweep_usd) : null,
    acknowledgment_text: String(row.acknowledgment_text || ""),
    acknowledged_at: String(row.acknowledged_at || ""),
    last_evaluated_at: row.last_evaluated_at != null ? String(row.last_evaluated_at) : null,
    last_executed_at: row.last_executed_at != null ? String(row.last_executed_at) : null,
    last_success_at: row.last_success_at != null ? String(row.last_success_at) : null,
    last_failure_at: row.last_failure_at != null ? String(row.last_failure_at) : null,
    last_failure_reason: row.last_failure_reason != null ? String(row.last_failure_reason) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  }
}

export async function createSweepRule(input: CreateSweepRuleInput): Promise<WalletSweepRule> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      merchant_id: input.merchantId,
      rail: input.rail,
      asset: input.asset,
      destination_id: input.destinationId,
      is_enabled: Boolean(input.isEnabled),
      mode: input.mode,
      threshold_amount_decimal: input.thresholdAmountDecimal ?? null,
      scheduled_time_utc: input.scheduledTimeUtc ?? null,
      min_remaining_reserve_decimal: input.minRemainingReserveDecimal ?? "0",
      max_daily_sweep_usd: input.maxDailySweepUsd ?? null,
      acknowledgment_text: input.acknowledgmentText,
      acknowledged_at: now,
      updated_at: now,
    })
    .select("*")
    .single()

  if (error || !data) {
    if (error?.code === "23505") {
      throw Object.assign(
        new Error("An enabled automatic sweep rule already exists for this asset and network."),
        { status: 409 }
      )
    }
    throw new Error(`Failed to create sweep rule: ${error?.message || "No data returned"}`)
  }
  return normalize(data as Record<string, unknown>)
}

export async function listSweepRulesForMerchant(merchantId: string): Promise<WalletSweepRule[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to list sweep rules: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function getSweepRule(merchantId: string, id: string): Promise<WalletSweepRule | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error(`Failed to load sweep rule: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function updateSweepRule(
  merchantId: string,
  id: string,
  input: UpdateSweepRuleInput
): Promise<WalletSweepRule> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.isEnabled !== undefined) patch.is_enabled = input.isEnabled
  if (input.mode !== undefined) patch.mode = input.mode
  if (input.thresholdAmountDecimal !== undefined) patch.threshold_amount_decimal = input.thresholdAmountDecimal
  if (input.scheduledTimeUtc !== undefined) patch.scheduled_time_utc = input.scheduledTimeUtc
  if (input.minRemainingReserveDecimal !== undefined) patch.min_remaining_reserve_decimal = input.minRemainingReserveDecimal
  if (input.maxDailySweepUsd !== undefined) patch.max_daily_sweep_usd = input.maxDailySweepUsd
  if (input.acknowledgmentText !== undefined) patch.acknowledgment_text = input.acknowledgmentText
  if (input.acknowledgedAt !== undefined) patch.acknowledged_at = input.acknowledgedAt

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("merchant_id", merchantId)
    .eq("id", id)
    .select("*")
    .maybeSingle()

  if (error) {
    if (error.code === "23505") {
      throw Object.assign(
        new Error("An enabled automatic sweep rule already exists for this asset and network."),
        { status: 409 }
      )
    }
    throw new Error(`Failed to update sweep rule: ${error.message}`)
  }
  if (!data) throw Object.assign(new Error("Sweep rule not found."), { status: 404 })
  return normalize(data as Record<string, unknown>)
}

/**
 * Cron-side, cross-merchant listing (not scoped to a single merchant) used
 * by engine/withdrawals/walletSweepEvaluation.ts to find every enabled rule
 * of a given mode that needs evaluating this tick.
 */
export async function listEnabledSweepRulesByMode(mode: SweepMode, limit = 200): Promise<WalletSweepRule[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("is_enabled", true)
    .eq("mode", mode)
    .order("last_evaluated_at", { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list enabled sweep rules: ${error.message}`)
  return (data || []).map((row) => normalize(row as Record<string, unknown>))
}

export async function getEnabledSweepRuleForAsset(
  merchantId: string,
  rail: SweepRail,
  asset: SweepAsset,
  mode: SweepMode
): Promise<WalletSweepRule | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("rail", rail)
    .eq("asset", asset)
    .eq("mode", mode)
    .eq("is_enabled", true)
    .maybeSingle()

  if (error) throw new Error(`Failed to load sweep rule: ${error.message}`)
  return data ? normalize(data as Record<string, unknown>) : null
}

export async function markSweepRuleEvaluated(id: string, at: string = new Date().toISOString()): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ last_evaluated_at: at }).eq("id", id)
  if (error) throw new Error(`Failed to mark sweep rule evaluated: ${error.message}`)
}

export async function markSweepRuleExecutionResult(
  id: string,
  outcome: "success" | "failure",
  reason?: string | null
): Promise<void> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { last_executed_at: now }
  if (outcome === "success") {
    patch.last_success_at = now
    patch.last_failure_reason = null
  } else {
    patch.last_failure_at = now
    patch.last_failure_reason = reason ?? null
  }
  const { error } = await supabase.from(TABLE).update(patch).eq("id", id)
  if (error) throw new Error(`Failed to record sweep rule execution result: ${error.message}`)
}
