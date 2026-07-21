import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createWalletWithdrawalReview: vi.fn(),
  createBitcoinWalletWithdrawal: vi.fn(),
  updateWalletWithdrawalRequestCanonicalFields: vi.fn(),
  findWalletWithdrawalRequestByIdempotencyKey: vi.fn(),
  updateWalletOperationCanonicalFields: vi.fn(),
  getWithdrawalDestination: vi.fn(),
  markWithdrawalDestinationUsed: vi.fn(),
}))

vi.mock("@/engine/withdrawals/walletWithdrawals", () => ({
  createWalletWithdrawalReview: mocks.createWalletWithdrawalReview,
}))

vi.mock("@/engine/wallet/walletOperations", () => ({
  createWalletWithdrawal: mocks.createBitcoinWalletWithdrawal,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  updateWalletWithdrawalRequestCanonicalFields: mocks.updateWalletWithdrawalRequestCanonicalFields,
  findWalletWithdrawalRequestByIdempotencyKey: mocks.findWalletWithdrawalRequestByIdempotencyKey,
}))

vi.mock("@/database/merchantWalletOperations", () => ({
  updateWalletOperationCanonicalFields: mocks.updateWalletOperationCanonicalFields,
}))

vi.mock("@/database/merchantWithdrawalDestinations", () => ({
  getWithdrawalDestination: mocks.getWithdrawalDestination,
  markWithdrawalDestinationUsed: mocks.markWithdrawalDestinationUsed,
}))

import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"

const CONFIRMED_DESTINATION = {
  id: "dest_1",
  merchant_id: "merchant_1",
  rail: "base",
  asset: "USDC",
  method: null,
  destination_address: "0x1234567890abcdef1234567890abcdef12345678",
  label: "Coinbase",
  is_default: false,
  is_enabled: true,
  provider_name: "Coinbase",
  memo_or_tag: null,
  confirmation_status: "confirmed",
  merchant_confirmed_at: "2026-07-20T00:00:00Z",
  last_used_at: null,
  archived_at: null,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
}

describe("submitCanonicalWithdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateWalletWithdrawalRequestCanonicalFields.mockImplementation(async (_m, _id, input) => ({
      id: "wd_1",
      source: input.source,
      destination_id: input.destinationId ?? null,
    }))
    mocks.findWalletWithdrawalRequestByIdempotencyKey.mockResolvedValue(null)
  })

  it("requires exactly one of destinationId or destinationAddress", async () => {
    await expect(
      submitCanonicalWithdrawal({
        merchantId: "merchant_1",
        rail: "base",
        asset: "ETH",
        amountDecimal: "1",
        source: "manual",
        idempotencyKey: "key-1",
      })
    ).rejects.toThrow("Provide exactly one of a saved destination or a manually entered address.")

    await expect(
      submitCanonicalWithdrawal({
        merchantId: "merchant_1",
        rail: "base",
        asset: "ETH",
        amountDecimal: "1",
        source: "manual",
        idempotencyKey: "key-1",
        destinationId: "dest_1",
        destinationAddress: "0xabc",
      })
    ).rejects.toThrow("Provide exactly one of a saved destination or a manually entered address.")
  })

  it("rejects automatic_sweep source with a raw (non-saved) destination address", async () => {
    await expect(
      submitCanonicalWithdrawal({
        merchantId: "merchant_1",
        rail: "base",
        asset: "USDC",
        amountDecimal: "10",
        source: "automatic_sweep",
        idempotencyKey: "key-1",
        destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      })
    ).rejects.toThrow("Automatic sweeps must use a saved, confirmed destination - never a raw address.")
  })

  it("rejects automatic_sweep when the saved destination is not yet confirmed", async () => {
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, confirmation_status: "unconfirmed" })

    await expect(
      submitCanonicalWithdrawal({
        merchantId: "merchant_1",
        rail: "base",
        asset: "USDC",
        amountDecimal: "10",
        source: "automatic_sweep",
        idempotencyKey: "key-1",
        destinationId: "dest_1",
      })
    ).rejects.toThrow("This destination must be confirmed before it can back an automatic sweep.")
  })

  it("rejects a destination whose asset/rail doesn't match the requested withdrawal", async () => {
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, asset: "ETH" })

    await expect(
      submitCanonicalWithdrawal({
        merchantId: "merchant_1",
        rail: "base",
        asset: "USDC",
        amountDecimal: "10",
        source: "saved_address",
        idempotencyKey: "key-1",
        destinationId: "dest_1",
      })
    ).rejects.toThrow("Saved destination does not match the selected asset and network.")
  })

  it("rejects a disabled saved destination", async () => {
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, is_enabled: false })

    await expect(
      submitCanonicalWithdrawal({
        merchantId: "merchant_1",
        rail: "base",
        asset: "USDC",
        amountDecimal: "10",
        source: "saved_address",
        idempotencyKey: "key-1",
        destinationId: "dest_1",
      })
    ).rejects.toThrow("This saved destination is disabled.")
  })

  it("routes Base/Solana to the review flow, stamps canonical fields, and never executes anything", async () => {
    mocks.createWalletWithdrawalReview.mockResolvedValue({
      request: { id: "wd_1" },
      review: { rail: "base", asset: "ETH" },
      canSubmit: true,
    })

    const result = await submitCanonicalWithdrawal({
      merchantId: "merchant_1",
      rail: "base",
      asset: "ETH",
      amountDecimal: "0.5",
      source: "manual",
      idempotencyKey: "key-1",
      destinationAddress: "0xabc0000000000000000000000000000000000a",
    })

    expect(result.kind).toBe("review_required")
    expect(mocks.createBitcoinWalletWithdrawal).not.toHaveBeenCalled()
    expect(mocks.updateWalletWithdrawalRequestCanonicalFields).toHaveBeenCalledWith(
      "merchant_1",
      "wd_1",
      expect.objectContaining({ source: "manual", idempotencyKey: "key-1" })
    )
  })

  it("reuses an existing review for the same idempotency key instead of creating a second one", async () => {
    mocks.findWalletWithdrawalRequestByIdempotencyKey.mockResolvedValue({
      id: "wd_existing",
      status: "review_required",
      review_payload: { rail: "base", asset: "ETH" },
    })
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, asset: "ETH" })

    const result = await submitCanonicalWithdrawal({
      merchantId: "merchant_1",
      rail: "base",
      asset: "ETH",
      amountDecimal: "0.5",
      source: "automatic_sweep",
      idempotencyKey: "sweep-review:job_1",
      destinationId: "dest_1",
    })

    expect(result.kind).toBe("review_required")
    expect(mocks.createWalletWithdrawalReview).not.toHaveBeenCalled()
  })

  it("routes Bitcoin to the generic wallet-operations engine and stamps canonical fields on the resulting operation", async () => {
    mocks.createBitcoinWalletWithdrawal.mockResolvedValue({
      operation: { id: "op_1", status: "PROCESSING" },
      capabilityAvailable: true,
    })
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, id: "dest_btc", rail: "bitcoin", asset: "BTC", method: "onchain" })

    const result = await submitCanonicalWithdrawal({
      merchantId: "merchant_1",
      rail: "bitcoin",
      asset: "BTC",
      amountDecimal: "0.001",
      source: "automatic_sweep",
      idempotencyKey: "withdrawal-for-sweep:job_1",
      destinationId: "dest_btc",
    })

    expect(result.kind).toBe("executed")
    expect(mocks.createWalletWithdrawalReview).not.toHaveBeenCalled()
    expect(mocks.createBitcoinWalletWithdrawal).toHaveBeenCalledWith(
      "merchant_1",
      expect.objectContaining({ asset: "SATS", idempotencyKey: "withdrawal-for-sweep:job_1" })
    )
    expect(mocks.updateWalletOperationCanonicalFields).toHaveBeenCalledWith(
      "merchant_1",
      "op_1",
      expect.objectContaining({ source: "automatic_sweep" })
    )
    expect(mocks.markWithdrawalDestinationUsed).toHaveBeenCalledWith("merchant_1", "dest_btc")
  })
})
