import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPineTreeWalletProfile: vi.fn(),
  createWalletWithdrawalRequest: vi.fn(),
  findOpenUnsignedWalletWithdrawalReview: vi.fn(),
  findInFlightOrCompletedWithdrawalForDestination: vi.fn(),
  getWalletWithdrawalRequest: vi.fn(),
  updateWalletWithdrawalRequest: vi.fn(),
  getMerchantProviders: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  createConnectedAccountWithdrawal: vi.fn(),
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  createWalletWithdrawalRequest: mocks.createWalletWithdrawalRequest,
  findOpenUnsignedWalletWithdrawalReview: mocks.findOpenUnsignedWalletWithdrawalReview,
  findInFlightOrCompletedWithdrawalForDestination: mocks.findInFlightOrCompletedWithdrawalForDestination,
  getWalletWithdrawalRequest: mocks.getWalletWithdrawalRequest,
  updateWalletWithdrawalRequest: mocks.updateWalletWithdrawalRequest,
}))

vi.mock("@/database/merchantAuditEvents", () => ({
  insertWithdrawalAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/database/merchants", () => ({
  getMerchantProviders: mocks.getMerchantProviders,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
}))

vi.mock("@/providers/lightning/speedWalletManagement", () => ({
  createConnectedAccountWithdrawal: mocks.createConnectedAccountWithdrawal,
}))

import { createWalletWithdrawalReview, submitWalletWithdrawalRequest } from "@/engine/withdrawals/walletWithdrawals"
import { createDefaultWithdrawalSigner } from "@/providers/wallets/withdrawalSigner"

const MAINNET_BOLT11 = "lnbc10u1p3xnhl2sp5jctpcz4nkfjzaqwsjssjfw0abcdefghijklmnopqrstuvwxyz"
const MAINNET_SEGWIT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"

function makeWithdrawal(overrides: Record<string, unknown> = {}) {
  return {
    id: "withdrawal_btc_1",
    merchant_id: "merchant_1",
    wallet_profile_id: "wallet_profile_1",
    rail: "bitcoin",
    asset: "BTC",
    destination_address: MAINNET_BOLT11,
    amount_decimal: "0.00025",
    status: "review_required",
    provider: null,
    provider_reference: null,
    tx_hash: null,
    unsigned_transaction_payload: null,
    signed_payload: null,
    approval_method: "manual_review",
    chain_id: null,
    token_contract: null,
    token_mint: null,
    review_payload: {},
    error_message: null,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  }
}

describe("Bitcoin withdrawals via connected Speed account", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    process.env.BITCOIN_NETWORK = "mainnet"
    delete process.env.PINETREE_ENABLE_DYNAMIC_BTC_LEGACY
    delete process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID

    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "wallet_profile_1",
      base_address: null,
      solana_address: null,
      btc_address: null,
      bitcoin_onchain_address: null,
      btc_payout_enabled: false,
    })
    mocks.getMerchantProviders.mockResolvedValue([
      { provider: "lightning_speed", enabled: true, status: "connected", credentials: {} },
    ])
    mocks.getMerchantLightningProfile.mockResolvedValue({
      status: "ready",
      speed_account_id: "acct_live_123",
      speed_connected_account_status: "Active",
    })
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({ configured: true, missing: [] })
    mocks.findOpenUnsignedWalletWithdrawalReview.mockResolvedValue(null)
    mocks.findInFlightOrCompletedWithdrawalForDestination.mockResolvedValue(null)
    mocks.createWalletWithdrawalRequest.mockImplementation(async (input) => makeWithdrawal(input))
  })

  /** Wires getWalletWithdrawalRequest + updateWalletWithdrawalRequest to share
   *  one mutable record, so a partial update (e.g. {status:"processing"}) is
   *  merged onto the real prior state instead of resetting to test defaults -
   *  mirroring how the real DB row behaves across submitWalletWithdrawalRequest's
   *  multiple sequential updates. */
  function seedWithdrawal(overrides: Record<string, unknown> = {}) {
    let record = makeWithdrawal(overrides)
    mocks.getWalletWithdrawalRequest.mockImplementation(async () => record)
    mocks.updateWalletWithdrawalRequest.mockImplementation(async (_merchantId, id, input) => {
      record = { ...record, id, ...input }
      return record
    })
    return () => record
  }

  it("allows a Bitcoin/Lightning review with no PineTree source address required", async () => {
    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_BOLT11,
      amountDecimal: "0.00025",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(true)
    expect(result.review.approvalMethod).toBe("manual_review")
    expect(mocks.createWalletWithdrawalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ provider: null, approvalMethod: "manual_review" })
    )
  })

  it("allows a Bitcoin on-chain address review the same way as a Lightning destination", async () => {
    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_SEGWIT,
      amountDecimal: "0.001",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(true)
  })

  it("blocks the review when the merchant has no ready Speed account", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)

    await expect(createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_BOLT11,
      amountDecimal: "0.00025",
    }, createDefaultWithdrawalSigner())).rejects.toThrow(
      "Bitcoin withdrawals require a connected, ready Speed account."
    )
  })

  it("submits a Lightning (BOLT11) withdrawal through Speed Instant Send with the correct sats amount", async () => {
    seedWithdrawal({ destination_address: MAINNET_BOLT11, amount_decimal: "0.00025" })
    mocks.createConnectedAccountWithdrawal.mockResolvedValue({
      id: "is_001", status: "unpaid", amount: 25000, currency: "SATS",
      target_amount: 25000, target_currency: "SATS", fees: 1,
      withdraw_method: "lightning", withdraw_type: "lightning_invoice",
      created: 1, modified: 1,
    })

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_btc_1", createDefaultWithdrawalSigner())

    expect(mocks.createConnectedAccountWithdrawal).toHaveBeenCalledWith({
      merchantId: "merchant_1",
      speedAccountId: "acct_live_123",
      amount: 25000,
      currency: "SATS",
      withdrawMethod: "lightning",
      withdrawRequest: MAINNET_BOLT11,
      idempotencyKey: "withdrawal_btc_1",
    })
    expect(result.merchantStatus).toBe("Processing")
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith("merchant_1", "withdrawal_btc_1", {
      status: "processing",
      provider: "speed",
      providerReference: "is_001",
      txHash: null,
      errorMessage: null,
    })
  })

  it("submits an on-chain Bitcoin withdrawal through Speed with withdrawMethod onchain", async () => {
    seedWithdrawal({ destination_address: MAINNET_SEGWIT, amount_decimal: "0.001" })
    mocks.createConnectedAccountWithdrawal.mockResolvedValue({
      id: "is_002", status: "unpaid", amount: 100000, currency: "SATS",
      target_amount: 100000, target_currency: "SATS", fees: 500,
      withdraw_method: "onchain", withdraw_type: "onchain_address",
      created: 1, modified: 1,
    })

    await submitWalletWithdrawalRequest("merchant_1", "withdrawal_btc_1", createDefaultWithdrawalSigner())

    expect(mocks.createConnectedAccountWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ withdrawMethod: "onchain", withdrawRequest: MAINNET_SEGWIT, amount: 100000 })
    )
  })

  it("rejects reusing a BOLT11 invoice that already has an in-flight or completed withdrawal", async () => {
    seedWithdrawal({ destination_address: MAINNET_BOLT11 })
    mocks.findInFlightOrCompletedWithdrawalForDestination.mockResolvedValue(
      makeWithdrawal({ id: "withdrawal_btc_prior", status: "confirmed" })
    )

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_btc_1", createDefaultWithdrawalSigner())

    expect(result.merchantStatus).toBe("Withdrawal failed")
    expect(mocks.createConnectedAccountWithdrawal).not.toHaveBeenCalled()
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1", "withdrawal_btc_1",
      expect.objectContaining({ status: "failed" })
    )
  })

  it("never mislabels a Speed-executed Bitcoin withdrawal as dynamic_browser", async () => {
    const review = await createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: MAINNET_BOLT11,
      amountDecimal: "0.00025",
    }, createDefaultWithdrawalSigner())

    expect(review.review.approvalMethod).not.toBe("dynamic_browser")
  })
})
