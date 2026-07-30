import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  estimateMaxWithdrawalAmount: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest,
  getRouteErrorStatus: vi.fn(() => 500),
}))

vi.mock("@/engine/withdrawals/withdrawalFeeEstimate", () => ({
  estimateMaxWithdrawalAmount: mocks.estimateMaxWithdrawalAmount,
}))

import { POST } from "@/app/api/wallets/pinetree-wallet/withdrawals/max-estimate/route"

function request(body: Record<string, unknown>) {
  return new NextRequest("https://app.test/api/wallets/pinetree-wallet/withdrawals/max-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("withdrawal Max estimate route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue("merchant_1")
    mocks.estimateMaxWithdrawalAmount.mockResolvedValue({
      maxDecimal: "0.001",
      feeEstimateDecimal: "0.00001",
      feeAsset: "BTC",
    })
  })

  it("rejects an explicit unsupported Bitcoin method instead of assuming Lightning", async () => {
    const response = await POST(request({ rail: "bitcoin", asset: "BTC", bitcoin_method: "sideways" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Unsupported Bitcoin withdrawal method." })
    expect(mocks.estimateMaxWithdrawalAmount).not.toHaveBeenCalled()
  })

  it("passes the selected Bitcoin method into the authoritative estimate", async () => {
    const response = await POST(request({ rail: "bitcoin", asset: "BTC", bitcoin_method: "onchain" }))

    expect(response.status).toBe(200)
    expect(mocks.estimateMaxWithdrawalAmount).toHaveBeenCalledWith(
      "merchant_1",
      "bitcoin",
      "BTC",
      { bitcoinMethod: "onchain" }
    )
  })

  it("rejects unsupported rail/asset pairs before estimation", async () => {
    const response = await POST(request({ rail: "base", asset: "SOL" }))

    expect(response.status).toBe(400)
    expect(mocks.estimateMaxWithdrawalAmount).not.toHaveBeenCalled()
  })

  it("requires the actual Solana USDC destination so ATA rent is not guessed", async () => {
    const response = await POST(request({ rail: "solana", asset: "USDC" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "A Solana destination is required to estimate token-account rent.",
    })
    expect(mocks.estimateMaxWithdrawalAmount).not.toHaveBeenCalled()
  })
})
