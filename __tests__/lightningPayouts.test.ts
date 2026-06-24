import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  getTransactionByPaymentId: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  claimLightningPayoutJob: vi.fn(),
  createLightningPayoutJobIfMissing: vi.fn(),
  getLightningPayoutJobByPayment: vi.fn(),
  listPendingLightningPayoutJobs: vi.fn(),
  markLightningPayoutJobCompleted: vi.fn(),
  markLightningPayoutJobFailed: vi.fn(),
  createSpeedWithdrawRequest: vi.fn(),
  isSpeedPlatformTreasurySweepEnabled: vi.fn(),
}))

vi.mock("@/database/payments", () => ({
  getPaymentById: mocks.getPaymentById,
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: mocks.getTransactionByPaymentId,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/lightningPayoutJobs", () => ({
  claimLightningPayoutJob: mocks.claimLightningPayoutJob,
  createLightningPayoutJobIfMissing: mocks.createLightningPayoutJobIfMissing,
  getLightningPayoutJobByPayment: mocks.getLightningPayoutJobByPayment,
  listPendingLightningPayoutJobs: mocks.listPendingLightningPayoutJobs,
  markLightningPayoutJobCompleted: mocks.markLightningPayoutJobCompleted,
  markLightningPayoutJobFailed: mocks.markLightningPayoutJobFailed,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  createSpeedWithdrawRequest: mocks.createSpeedWithdrawRequest,
  isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE: "speed_platform_treasury_sweep",
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
}))

import {
  ensureLightningPayoutJobForConfirmedSpeedPayment,
  processPendingLightningPayoutJobs,
} from "@/engine/lightningPayouts"

const payment = {
  id: "pay_1",
  merchant_id: "merchant_1",
  merchant_amount: 10,
  pinetree_fee: 0.25,
  gross_amount: 10.25,
  currency: "USD",
  provider: "lightning_speed",
  provider_reference: "speed_pay_1",
  status: "CONFIRMED",
  network: "bitcoin_lightning",
  metadata: {
    split: {
      quotePriceUsd: 100_000,
    },
  },
  created_at: "2026-06-23T00:00:00.000Z",
  updated_at: "2026-06-23T00:00:00.000Z",
}

const job = {
  id: "job_1",
  merchant_id: "merchant_1",
  payment_id: "pay_1",
  transaction_id: "tx_1",
  provider: "lightning_speed",
  settlement_mode: "speed_platform_treasury_sweep",
  speed_invoice_id: "speed_pay_1",
  speed_payment_id: "speed_pay_1",
  gross_amount_usd: 10.25,
  platform_fee_usd: 0.25,
  merchant_net_usd: 10,
  merchant_net_sats: 10_000,
  btc_payout_address: "",
  btc_address_type: null,
  status: "pending",
  speed_withdraw_request_id: null,
  speed_payout_id: null,
  txid: null,
  attempt_count: 0,
  last_error: null,
  next_attempt_at: null,
  created_at: "2026-06-23T00:00:00.000Z",
  updated_at: "2026-06-23T00:00:00.000Z",
  completed_at: null,
} as const

describe("Speed treasury-sweep Lightning payout jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(true)
    mocks.getPaymentById.mockResolvedValue(payment)
    mocks.getTransactionByPaymentId.mockResolvedValue({ id: "tx_1" })
    mocks.getLightningPayoutJobByPayment.mockResolvedValue(null)
    mocks.createLightningPayoutJobIfMissing.mockResolvedValue(job)
    mocks.listPendingLightningPayoutJobs.mockResolvedValue([job])
    mocks.claimLightningPayoutJob.mockResolvedValue(job)
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      btc_address: "bc1ptestmerchant",
      btc_address_type: "taproot",
      btc_payout_enabled: true,
    })
    mocks.createSpeedWithdrawRequest.mockResolvedValue({
      id: "withdraw_1",
      payout_id: "payout_1",
      txid: "btc_tx_1",
    })
    mocks.markLightningPayoutJobCompleted.mockResolvedValue({ ...job, status: "completed" })
    mocks.markLightningPayoutJobFailed.mockResolvedValue({ ...job, status: "failed" })
  })

  it("confirmed Speed payment creates exactly one payout job", async () => {
    const payload = {
      type: "payment.paid",
      data: {
        object: {
          id: "speed_pay_1",
          metadata: {
            settlement_mode: "speed_platform_treasury_sweep",
            merchant_net_usd: 10,
            platform_fee_usd: 0.25,
          },
        },
      },
    }

    await ensureLightningPayoutJobForConfirmedSpeedPayment({ paymentId: "pay_1", payload })
    mocks.getLightningPayoutJobByPayment.mockResolvedValueOnce(job)
    await ensureLightningPayoutJobForConfirmedSpeedPayment({ paymentId: "pay_1", payload })

    expect(mocks.createLightningPayoutJobIfMissing).toHaveBeenCalledTimes(1)
    expect(mocks.createLightningPayoutJobIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: "pay_1",
        transaction_id: "tx_1",
        settlement_mode: "speed_platform_treasury_sweep",
        merchant_net_usd: 10,
      })
    )
  })

  it("feature flag disabled preserves old behavior by skipping payout job creation", async () => {
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)

    await ensureLightningPayoutJobForConfirmedSpeedPayment({ paymentId: "pay_1" })

    expect(mocks.createLightningPayoutJobIfMissing).not.toHaveBeenCalled()
  })

  it("requires merchant BTC payout address before processing", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      btc_address: null,
      btc_payout_enabled: false,
    })

    const result = await processPendingLightningPayoutJobs()

    expect(result.failed).toBe(1)
    expect(mocks.createSpeedWithdrawRequest).not.toHaveBeenCalled()
    expect(mocks.markLightningPayoutJobFailed).toHaveBeenCalledWith(
      "job_1",
      expect.stringContaining("BTC payout address"),
    )
  })

  it("worker calls Speed withdraw once and stores payout references", async () => {
    const result = await processPendingLightningPayoutJobs()

    expect(result.completed).toBe(1)
    expect(mocks.createSpeedWithdrawRequest).toHaveBeenCalledTimes(1)
    expect(mocks.createSpeedWithdrawRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10_000,
        currency: "SATS",
        destinationBtcAddress: "bc1ptestmerchant",
        destinationAddressType: "taproot",
        merchantId: "merchant_1",
        paymentId: "pay_1",
        idempotencyKey: "lightning-payout:job_1",
      })
    )
    expect(mocks.markLightningPayoutJobCompleted).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        speedWithdrawRequestId: "withdraw_1",
        speedPayoutId: "payout_1",
        txid: "btc_tx_1",
        providerResponseSummary: expect.objectContaining({
          id: "withdraw_1",
          payout_id: "payout_1",
          txid: "btc_tx_1",
        }),
      })
    )
  })

  it("failed Speed payout stores last_error and remains retryable", async () => {
    mocks.createSpeedWithdrawRequest.mockRejectedValue(new Error("Speed payout rejected"))

    const result = await processPendingLightningPayoutJobs()

    expect(result.failed).toBe(1)
    expect(mocks.markLightningPayoutJobFailed).toHaveBeenCalledWith(
      "job_1",
      "Speed payout rejected",
    )
  })
})
