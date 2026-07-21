import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listEnabledSweepRulesByMode: vi.fn(),
  listSweepRulesForMerchant: vi.fn(),
  markSweepRuleEvaluated: vi.fn(),
  createSweepJob: vi.fn(),
  sumQueuedSweepAmount: vi.fn(),
  sumConfirmedSweepAmountTodayForRule: vi.fn(),
  sumPendingWalletWithdrawalAmount: vi.fn(),
  sumPendingWithdrawalOperationBaseUnits: vi.fn(),
  getWalletBalance: vi.fn(),
  getWithdrawalDestination: vi.fn(),
  getMarketPricesUSD: vi.fn(),
}))

vi.mock("@/database/walletSweepRules", () => ({
  listEnabledSweepRulesByMode: mocks.listEnabledSweepRulesByMode,
  listSweepRulesForMerchant: mocks.listSweepRulesForMerchant,
  markSweepRuleEvaluated: mocks.markSweepRuleEvaluated,
}))

vi.mock("@/database/walletSweepJobs", () => ({
  createSweepJob: mocks.createSweepJob,
  sumQueuedSweepAmount: mocks.sumQueuedSweepAmount,
  sumConfirmedSweepAmountTodayForRule: mocks.sumConfirmedSweepAmountTodayForRule,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  sumPendingWalletWithdrawalAmount: mocks.sumPendingWalletWithdrawalAmount,
}))

vi.mock("@/database/merchantWalletOperations", () => ({
  sumPendingWithdrawalOperationBaseUnits: mocks.sumPendingWithdrawalOperationBaseUnits,
}))

vi.mock("@/database/walletBalances", () => ({
  getWalletBalance: mocks.getWalletBalance,
}))

vi.mock("@/database/merchantWithdrawalDestinations", () => ({
  getWithdrawalDestination: mocks.getWithdrawalDestination,
}))

vi.mock("@/engine/marketPrices", () => ({
  getMarketPricesUSD: mocks.getMarketPricesUSD,
}))

import {
  evaluateThresholdSweepRules,
  evaluateDailySweepRules,
  evaluatePerPaymentSweepForConfirmedPayment,
} from "@/engine/withdrawals/walletSweepEvaluation"

const CONFIRMED_DESTINATION = {
  id: "dest_1",
  rail: "base",
  asset: "USDC",
  is_enabled: true,
  confirmation_status: "confirmed",
  archived_at: null,
}

const BASE_RULE = {
  id: "rule_1",
  merchant_id: "merchant_1",
  rail: "base",
  asset: "USDC",
  destination_id: "dest_1",
  is_enabled: true,
  mode: "threshold",
  threshold_amount_decimal: "100",
  scheduled_time_utc: null,
  min_remaining_reserve_decimal: "0",
  max_daily_sweep_usd: null,
}

describe("wallet sweep eligibility evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WALLET_SWEEP_ENABLED = "true"
    mocks.markSweepRuleEvaluated.mockResolvedValue(undefined)
    mocks.getWithdrawalDestination.mockResolvedValue(CONFIRMED_DESTINATION)
    mocks.sumPendingWalletWithdrawalAmount.mockResolvedValue(0)
    mocks.sumQueuedSweepAmount.mockResolvedValue(0)
    mocks.sumConfirmedSweepAmountTodayForRule.mockResolvedValue(0)
    mocks.getMarketPricesUSD.mockResolvedValue({ SOL: 100, ETH: 2000, BTC: 60000 })
    mocks.createSweepJob.mockImplementation(async (input) => ({
      job: { id: "job_1", ...input },
      created: true,
    }))
  })

  it("does nothing when the sweep subsystem is disabled (WALLET_SWEEP_ENABLED unset)", async () => {
    process.env.WALLET_SWEEP_ENABLED = "false"
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([BASE_RULE])

    const outcomes = await evaluateThresholdSweepRules()

    expect(outcomes).toEqual([])
    expect(mocks.listEnabledSweepRulesByMode).not.toHaveBeenCalled()
  })

  it("queues a threshold sweep when available balance exceeds the configured threshold", async () => {
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([BASE_RULE])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })

    const outcomes = await evaluateThresholdSweepRules()

    expect(outcomes).toEqual([{ queued: true, reason: "queued", jobId: "job_1" }])
    expect(mocks.createSweepJob).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "rule_1", amountDecimal: "150", triggerKind: "threshold" })
    )
  })

  it("does not queue when available balance is below the threshold", async () => {
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([BASE_RULE])
    mocks.getWalletBalance.mockResolvedValue({ balance: "50" })

    const outcomes = await evaluateThresholdSweepRules()

    expect(outcomes).toEqual([{ queued: false, reason: "below_threshold" }])
    expect(mocks.createSweepJob).not.toHaveBeenCalled()
  })

  it("never sweeps when the destination is unconfirmed - even if the rule is enabled", async () => {
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([BASE_RULE])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, confirmation_status: "unconfirmed" })

    const outcomes = await evaluateThresholdSweepRules()

    expect(outcomes).toEqual([{ queued: false, reason: "destination_not_confirmed" }])
    expect(mocks.createSweepJob).not.toHaveBeenCalled()
  })

  it("subtracts pending withdrawals and already-queued sweeps before comparing against the threshold", async () => {
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([BASE_RULE])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })
    mocks.sumPendingWalletWithdrawalAmount.mockResolvedValue(60)

    const outcomes = await evaluateThresholdSweepRules()

    // 150 - 60 pending = 90, below the 100 threshold
    expect(outcomes).toEqual([{ queued: false, reason: "below_threshold" }])
  })

  it("enforces the max_daily_sweep_usd safety cap", async () => {
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([{ ...BASE_RULE, max_daily_sweep_usd: 50 }])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })
    mocks.sumConfirmedSweepAmountTodayForRule.mockResolvedValue(0)

    const outcomes = await evaluateThresholdSweepRules()

    // 150 USDC == $150, exceeds the $50 daily cap
    expect(outcomes).toEqual([{ queued: false, reason: "max_daily_sweep_cap_reached" }])
    expect(mocks.createSweepJob).not.toHaveBeenCalled()
  })

  it("only fires a daily rule once its scheduled time has passed for the current UTC day", async () => {
    const dailyRule = { ...BASE_RULE, mode: "daily", threshold_amount_decimal: null, scheduled_time_utc: "23:00:00" }
    mocks.listEnabledSweepRulesByMode.mockResolvedValue([dailyRule])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })

    const before = await evaluateDailySweepRules(new Date("2026-07-20T10:00:00Z"))
    expect(before).toEqual([])
    expect(mocks.createSweepJob).not.toHaveBeenCalled()

    const after = await evaluateDailySweepRules(new Date("2026-07-20T23:30:00Z"))
    expect(after).toEqual([{ queued: true, reason: "queued", jobId: "job_1" }])
  })

  it("evaluates only enabled per_payment rules for the merchant on payment confirmation", async () => {
    const perPaymentRule = { ...BASE_RULE, mode: "per_payment", threshold_amount_decimal: null }
    mocks.listSweepRulesForMerchant.mockResolvedValue([
      perPaymentRule,
      { ...perPaymentRule, id: "rule_2", is_enabled: false },
      { ...BASE_RULE, id: "rule_3" }, // threshold mode, should be ignored here
    ])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })

    const outcomes = await evaluatePerPaymentSweepForConfirmedPayment("merchant_1", "payment_1")

    expect(outcomes).toHaveLength(1)
    expect(mocks.createSweepJob).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: "rule_1",
        triggerKind: "payment_confirmed",
        triggerPaymentId: "payment_1",
        idempotencyKey: "sweep:rule_1:payment:payment_1",
      })
    )
  })

  it("idempotency key collision makes a second createSweepJob call for the same payment a no-op (created: false)", async () => {
    const perPaymentRule = { ...BASE_RULE, mode: "per_payment", threshold_amount_decimal: null }
    mocks.listSweepRulesForMerchant.mockResolvedValue([perPaymentRule])
    mocks.getWalletBalance.mockResolvedValue({ balance: "150" })
    mocks.createSweepJob.mockResolvedValueOnce({ job: { id: "job_1" }, created: false })

    const outcomes = await evaluatePerPaymentSweepForConfirmedPayment("merchant_1", "payment_1")

    expect(outcomes).toEqual([{ queued: false, reason: "already_queued", jobId: "job_1" }])
  })
})
