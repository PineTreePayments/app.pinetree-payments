import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPineTreeWalletProfile: vi.fn(),
  createWalletWithdrawalRequest: vi.fn(),
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  createWalletWithdrawalRequest: mocks.createWalletWithdrawalRequest,
}))

import {
  createWalletWithdrawalReview,
  validateWalletWithdrawalInput,
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
        : "Signing not enabled yet" as const
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
    submitWithdrawal: vi.fn(),
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
      review_payload: input.reviewPayload,
      error_message: input.errorMessage,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    }))
  })

  it("blocks invalid amount before review", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "base",
      asset: "ETH",
      destinationAddress: "0xDestination",
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

  it("creates a blocked request and never submits when signer is disabled", async () => {
    const signer = makeSigner(false)

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "base",
      asset: "USDC",
      destinationAddress: "0xDestination",
      amountDecimal: "12.50",
    }, signer)

    expect(result.canSubmit).toBe(false)
    expect(result.request.status).toBe("blocked")
    expect(mocks.createWalletWithdrawalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_1",
        walletProfileId: "wallet_profile_1",
        rail: "base",
        asset: "USDC",
        destinationAddress: "0xDestination",
        amountDecimal: "12.50",
        status: "blocked",
        errorMessage: "Signing not enabled yet",
      })
    )
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("creates only a review_required request when signer reports enabled", async () => {
    const signer = makeSigner(true)

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "solana",
      asset: "SOL",
      destinationAddress: "SolDestination",
      amountDecimal: "1.2",
    }, signer)

    expect(result.canSubmit).toBe(true)
    expect(result.request.status).toBe("review_required")
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })
})
