import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPineTreeWalletProfile: vi.fn(),
  createWalletWithdrawalRequest: vi.fn(),
  getWalletWithdrawalRequest: vi.fn(),
  updateWalletWithdrawalRequest: vi.fn(),
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  createWalletWithdrawalRequest: mocks.createWalletWithdrawalRequest,
  getWalletWithdrawalRequest: mocks.getWalletWithdrawalRequest,
  updateWalletWithdrawalRequest: mocks.updateWalletWithdrawalRequest,
}))

import {
  createWalletWithdrawalReview,
  submitWalletWithdrawalRequest,
  validateWalletWithdrawalInput,
  WALLET_WITHDRAWAL_VALIDATION_PATHS,
} from "@/engine/withdrawals/walletWithdrawals"
import type { WithdrawalSigner } from "@/providers/wallets/withdrawalSigner"

function makeSigner(canSign: boolean): WithdrawalSigner & {
  submitWithdrawal: ReturnType<typeof vi.fn>
} {
  return {
    canSignWithdrawal: vi.fn(async () => canSign),
    createWithdrawalReview: vi.fn(async (input) => {
      const estimatedStatus = canSign
        ? "Withdrawal review available" as const
        : "Pending review" as const
      return {
        rail: input.rail,
        asset: input.asset,
        destinationAddress: input.destinationAddress,
        amountDecimal: input.amountDecimal,
        signerEnabled: canSign,
        estimatedStatus,
        message: canSign
          ? "Withdrawal review available"
          : "Withdrawal review available. Signing not enabled yet.",
      }
    }),
    submitWithdrawal: vi.fn(async () => ({
      provider: "test_provider",
      providerReference: "provider_ref_1",
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    })),
  }
}

function makeWithdrawal(overrides: Record<string, unknown> = {}) {
  return {
    id: "withdrawal_1",
    merchant_id: "merchant_1",
    wallet_profile_id: "wallet_profile_1",
    rail: "base",
    asset: "USDC",
    destination_address: "0x1234567890abcdef1234567890abcdef12345678",
    amount_decimal: "12.50",
    status: "review_required",
    provider: null,
    provider_reference: null,
    tx_hash: null,
    review_payload: {},
    error_message: null,
    created_at: "2026-06-25T00:00:00.000Z",
    updated_at: "2026-06-25T00:00:00.000Z",
    ...overrides,
  }
}

describe("PineTree Wallet withdrawals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
    })
    mocks.createWalletWithdrawalRequest.mockImplementation(async (input) => ({
      id: "withdrawal_1",
      merchant_id: input.merchantId,
      wallet_profile_id: input.walletProfileId,
      rail: input.rail,
      asset: input.asset,
      destination_address: input.destinationAddress,
      amount_decimal: input.amountDecimal,
      status: input.status,
      provider: input.provider,
      provider_reference: null,
      tx_hash: null,
      review_payload: input.reviewPayload,
      error_message: input.errorMessage,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    }))
    mocks.getWalletWithdrawalRequest.mockResolvedValue(makeWithdrawal())
    mocks.updateWalletWithdrawalRequest.mockImplementation(async (_merchantId, _id, input) => ({
      ...makeWithdrawal(),
      ...("status" in input ? { status: input.status } : {}),
      ...("provider" in input ? { provider: input.provider } : {}),
      ...("providerReference" in input ? { provider_reference: input.providerReference } : {}),
      ...("txHash" in input ? { tx_hash: input.txHash } : {}),
      ...("errorMessage" in input ? { error_message: input.errorMessage } : {}),
      ...("reviewPayload" in input ? { review_payload: input.reviewPayload } : {}),
    }))
  })

  it("blocks invalid amount before review", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "base",
      asset: "ETH",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "0",
    })).toThrow("Withdrawal amount must be positive.")
  })

  it("blocks empty destination before review", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "solana",
      asset: "SOL",
      destinationAddress: " ",
      amountDecimal: "1",
    })).toThrow("Destination address is required.")
  })

  it("blocks unsupported rail and asset combinations", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "bitcoin",
      asset: "USDC",
      destinationAddress: "bc1qdestination",
      amountDecimal: "1",
    })).toThrow("Unsupported rail/asset combination.")
  })

  it("creates a pending review request and never submits when signer is disabled", async () => {
    const signer = makeSigner(false)

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "base",
      asset: "USDC",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "12.50",
    }, signer)

    expect(result.canSubmit).toBe(false)
    expect(result.request.status).toBe("review_required")
    expect(mocks.createWalletWithdrawalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_1",
        walletProfileId: "wallet_profile_1",
        rail: "base",
        asset: "USDC",
        destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
        amountDecimal: "12.50",
        status: "review_required",
        errorMessage: null,
      })
    )
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("creates only a review_required request when signer reports enabled", async () => {
    const signer = makeSigner(true)

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "solana",
      asset: "SOL",
      destinationAddress: "11111111111111111111111111111111",
      amountDecimal: "1.2",
    }, signer)

    expect(result.canSubmit).toBe(true)
    expect(result.request.status).toBe("review_required")
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("submit with disabled signer keeps request pending review and never broadcasts", async () => {
    const signer = makeSigner(false)

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_1", signer)

    expect(result.merchantStatus).toBe("Pending review")
    expect(result.request.status).toBe("review_required")
    expect(result.message).toContain("Withdrawal request submitted")
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("enabled signer path calls submitWithdrawal exactly once and stores provider reference and tx hash", async () => {
    const signer = makeSigner(true)

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_1", signer)

    expect(result.merchantStatus).toBe("Processing")
    expect(signer.submitWithdrawal).toHaveBeenCalledTimes(1)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({ status: "pending" })
    )
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        status: "processing",
        provider: "test_provider",
        providerReference: "provider_ref_1",
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      })
    )
  })

  it("failed provider response sets failed status with a merchant-safe error", async () => {
    const signer = makeSigner(true)
    signer.submitWithdrawal.mockRejectedValueOnce(new Error("private key provider rejected request"))

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_1", signer)

    expect(result.merchantStatus).toBe("Withdrawal failed")
    expect(result.request.status).toBe("failed")
    expect(result.request.error_message).toBe("provider provider rejected request")
  })

  it("merchant cannot submit another merchant's withdrawal", async () => {
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(null)

    await expect(
      submitWalletWithdrawalRequest("merchant_2", "withdrawal_1", makeSigner(true))
    ).rejects.toThrow("Withdrawal request not found.")
  })

  it("validation paths exist for Base ETH, Base USDC, Solana SOL, Solana USDC, and Bitcoin BTC", () => {
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.baseEth).toMatchObject({ rail: "base", asset: "ETH" })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.baseUsdc).toMatchObject({
      rail: "base",
      asset: "USDC",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.solanaSol).toMatchObject({ rail: "solana", asset: "SOL" })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.solanaUsdc).toMatchObject({
      rail: "solana",
      asset: "USDC",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decimals: 6,
    })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.bitcoinBtc).toMatchObject({ rail: "bitcoin", asset: "BTC" })
  })
})
