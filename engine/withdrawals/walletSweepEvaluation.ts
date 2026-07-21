/**
 * Sweep eligibility evaluation - reads CONFIRMED balances only and, when a
 * rule's conditions are met, creates an idempotency-keyed QUEUED job. Never
 * moves funds itself (see engine/withdrawals/walletSweepExecution.ts for
 * that) - a bug here can at worst create a wrong QUEUED row, never actually
 * transfer money.
 *
 * A sweep may only be queued when: the merchant enabled the rule, the saved
 * destination is active and confirmed, the destination matches the rule's
 * asset/network, the available balance (after pending withdrawals, already-
 * queued sweeps, and the configured reserve) exceeds the configured
 * minimum, and there is no duplicate active sweep for the same funds
 * (enforced by the deterministic idempotency key, not a race-prone check).
 */

import {
  listEnabledSweepRulesByMode,
  markSweepRuleEvaluated,
  type WalletSweepRule,
} from "@/database/walletSweepRules"
import { createSweepJob, sumQueuedSweepAmount, sumConfirmedSweepAmountTodayForRule } from "@/database/walletSweepJobs"
import { sumPendingWalletWithdrawalAmount } from "@/database/walletWithdrawalRequests"
import { sumPendingWithdrawalOperationBaseUnits } from "@/database/merchantWalletOperations"
import { getWalletBalance } from "@/database/walletBalances"
import { getWithdrawalDestination } from "@/database/merchantWithdrawalDestinations"
import { getMarketPricesUSD } from "@/engine/marketPrices"
import { toBaseUnits, fromBaseUnits, clampNonNegative } from "@/engine/withdrawals/decimalUnits"

function getMinSweepValueUsd(): number {
  const configured = Number(process.env.MIN_SWEEP_VALUE_USD || "")
  return Number.isFinite(configured) && configured >= 0 ? configured : 5
}

function isSweepSubsystemEnabled(): boolean {
  return String(process.env.WALLET_SWEEP_ENABLED || "").trim().toLowerCase() === "true"
}

function walletBalanceKey(rail: string, asset: string): string {
  if (rail === "base") return asset === "ETH" ? "BASE_ETH" : "BASE_USDC"
  if (rail === "solana") return asset === "SOL" ? "SOLANA_SOL" : "SOLANA_USDC"
  return "BTC"
}

export type SweepEvaluationOutcome = { queued: boolean; reason: string; jobId?: string }

async function evaluateRuleOnce(
  rule: WalletSweepRule,
  triggerKind: "threshold" | "daily" | "payment_confirmed",
  triggerPaymentId?: string | null
): Promise<SweepEvaluationOutcome> {
  await markSweepRuleEvaluated(rule.id).catch(() => {})

  const destination = await getWithdrawalDestination(rule.merchant_id, rule.destination_id)
  if (!destination || destination.archived_at || !destination.is_enabled) {
    return { queued: false, reason: "destination_not_active" }
  }
  if (destination.confirmation_status !== "confirmed") {
    return { queued: false, reason: "destination_not_confirmed" }
  }
  if (destination.rail !== rule.rail || destination.asset !== rule.asset) {
    return { queued: false, reason: "destination_asset_mismatch" }
  }

  const balanceRow = await getWalletBalance(rule.merchant_id, walletBalanceKey(rule.rail, rule.asset))
  const confirmedBaseUnits = toBaseUnits(balanceRow?.balance ?? "0", rule.asset)

  const pendingWithdrawalBaseUnits = rule.rail === "bitcoin"
    ? await sumPendingWithdrawalOperationBaseUnits(rule.merchant_id, "SATS")
    : toBaseUnits(await sumPendingWalletWithdrawalAmount(rule.merchant_id, rule.rail, rule.asset), rule.asset)
  const pendingSweepBaseUnits = toBaseUnits(await sumQueuedSweepAmount(rule.merchant_id, rule.rail, rule.asset), rule.asset)
  const reserveBaseUnits = toBaseUnits(rule.min_remaining_reserve_decimal || "0", rule.asset)

  const availableBaseUnits = clampNonNegative(
    confirmedBaseUnits - pendingWithdrawalBaseUnits - pendingSweepBaseUnits - reserveBaseUnits
  )
  if (availableBaseUnits <= BigInt(0)) {
    return { queued: false, reason: "no_available_balance" }
  }

  if (rule.mode === "threshold") {
    const thresholdBaseUnits = toBaseUnits(rule.threshold_amount_decimal || "0", rule.asset)
    if (availableBaseUnits < thresholdBaseUnits) {
      return { queued: false, reason: "below_threshold" }
    }
  }

  const availableDecimal = fromBaseUnits(availableBaseUnits, rule.asset)
  const prices = await getMarketPricesUSD().catch(() => null)
  const priceUsd = !prices ? 0 : rule.asset === "USDC" ? 1 : (prices as Record<string, number>)[rule.asset] ?? 0
  const valueUsd = Number(availableDecimal) * priceUsd

  if (priceUsd > 0 && valueUsd < getMinSweepValueUsd()) {
    return { queued: false, reason: "below_min_sweep_value_usd" }
  }

  if (rule.max_daily_sweep_usd != null && priceUsd > 0) {
    const confirmedTodayDecimal = await sumConfirmedSweepAmountTodayForRule(rule.id)
    const confirmedTodayUsd = confirmedTodayDecimal * priceUsd
    if (confirmedTodayUsd + valueUsd > rule.max_daily_sweep_usd) {
      return { queued: false, reason: "max_daily_sweep_cap_reached" }
    }
  }

  const periodKey = new Date().toISOString().slice(0, 10)
  const idempotencyKey = triggerKind === "payment_confirmed" && triggerPaymentId
    ? `sweep:${rule.id}:payment:${triggerPaymentId}`
    : `sweep:${rule.id}:period:${periodKey}`

  const { job, created } = await createSweepJob({
    ruleId: rule.id,
    merchantId: rule.merchant_id,
    rail: rule.rail,
    asset: rule.asset,
    amountDecimal: availableDecimal,
    idempotencyKey,
    triggerKind,
    triggerPaymentId: triggerPaymentId ?? null,
    triggerBalanceSnapshot: {
      confirmed: fromBaseUnits(confirmedBaseUnits, rule.asset),
      pendingWithdrawal: fromBaseUnits(pendingWithdrawalBaseUnits, rule.asset),
      pendingSweep: fromBaseUnits(pendingSweepBaseUnits, rule.asset),
      reserve: fromBaseUnits(reserveBaseUnits, rule.asset),
      available: availableDecimal,
    },
  })

  return created
    ? { queued: true, reason: "queued", jobId: job.id }
    : { queued: false, reason: "already_queued", jobId: job.id }
}

/**
 * Called from the cron processor for every enabled threshold rule across all
 * merchants. Evaluates each independently - one rule's failure never blocks
 * another's.
 */
export async function evaluateThresholdSweepRules(limit = 200): Promise<SweepEvaluationOutcome[]> {
  if (!isSweepSubsystemEnabled()) return []
  const rules = await listEnabledSweepRulesByMode("threshold", limit)
  const outcomes: SweepEvaluationOutcome[] = []
  for (const rule of rules) {
    try {
      outcomes.push(await evaluateRuleOnce(rule, "threshold"))
    } catch (error) {
      console.warn("[walletSweepEvaluation] threshold evaluation failed", { ruleId: rule.id, error })
      outcomes.push({ queued: false, reason: "evaluation_error" })
    }
  }
  return outcomes
}

/**
 * Called from the cron processor for every enabled daily rule whose
 * scheduled_time_utc has passed for the current UTC day, across all
 * merchants. The idempotency key (sweep:{ruleId}:period:{isoDate}) prevents
 * a second job the same day even if the cron runs more than once after the
 * scheduled time.
 */
export async function evaluateDailySweepRules(nowUtc: Date = new Date(), limit = 200): Promise<SweepEvaluationOutcome[]> {
  if (!isSweepSubsystemEnabled()) return []
  const rules = await listEnabledSweepRulesByMode("daily", limit)
  const nowHms = nowUtc.toISOString().slice(11, 19)
  const outcomes: SweepEvaluationOutcome[] = []
  for (const rule of rules) {
    if (!rule.scheduled_time_utc || rule.scheduled_time_utc > nowHms) continue
    try {
      outcomes.push(await evaluateRuleOnce(rule, "daily"))
    } catch (error) {
      console.warn("[walletSweepEvaluation] daily evaluation failed", { ruleId: rule.id, error })
      outcomes.push({ queued: false, reason: "evaluation_error" })
    }
  }
  return outcomes
}

/**
 * Called from engine/eventProcessor.ts's payment.confirmed handling (both
 * the webhook path and the watcher/idempotent-replay path - safe to call
 * from both since a duplicate call always resolves to the same idempotency
 * key and createSweepJob no-ops on the second insert). Re-evaluates every
 * enabled per_payment rule for the merchant, not just the rail the
 * triggering payment happened to arrive on - "per payment" means "re-check
 * eligibility after every confirmed payment", not "sweep this payment's
 * exact amount", so it doesn't need to resolve the payment's specific
 * received asset.
 */
export async function evaluatePerPaymentSweepForConfirmedPayment(
  merchantId: string,
  paymentId: string
): Promise<SweepEvaluationOutcome[]> {
  if (!isSweepSubsystemEnabled()) return []
  const { listSweepRulesForMerchant } = await import("@/database/walletSweepRules")
  const rules = (await listSweepRulesForMerchant(merchantId)).filter(
    (rule) => rule.is_enabled && rule.mode === "per_payment"
  )
  const outcomes: SweepEvaluationOutcome[] = []
  for (const rule of rules) {
    try {
      outcomes.push(await evaluateRuleOnce(rule, "payment_confirmed", paymentId))
    } catch (error) {
      console.warn("[walletSweepEvaluation] per-payment evaluation failed", { ruleId: rule.id, paymentId, error })
      outcomes.push({ queued: false, reason: "evaluation_error" })
    }
  }
  return outcomes
}
