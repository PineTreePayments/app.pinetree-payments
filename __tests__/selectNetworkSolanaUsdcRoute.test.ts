import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { selectPaymentIntentNetworkEngine, verifyCheckoutSession } = vi.hoisted(() => ({
  selectPaymentIntentNetworkEngine: vi.fn(),
  verifyCheckoutSession: vi.fn(),
}))

vi.mock("@/engine/paymentIntents", () => ({
  selectPaymentIntentNetworkEngine,
}))

vi.mock("@/lib/api/checkoutAuth", () => ({
  verifyCheckoutSession,
}))

import { POST } from "@/app/api/payment-intents/[intentId]/select-network/route"

describe("payment intent select-network route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCheckoutSession.mockReturnValue({ iid: "intent-1" })
    selectPaymentIntentNetworkEngine.mockResolvedValue({
      paymentId: "payment-1",
      network: "solana",
      asset: "USDC",
      provider: "solana",
      nativeSymbol: "USDC",
    })
  })

  it("accepts USDC on Solana and forwards the selected asset", async () => {
    const request = new NextRequest("https://example.test/api/payment-intents/intent-1/select-network", {
      method: "POST",
      headers: {
        Authorization: "Bearer checkout-token",
        "Content-Type": "application/json",
        "Idempotency-Key": "intent-1-usdc",
      },
      body: JSON.stringify({ network: "solana", asset: "USDC" }),
    })

    const response = await POST(request, { params: Promise.resolve({ intentId: "intent-1" }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      network: "solana",
      asset: "USDC",
      nativeSymbol: "USDC",
    })
    expect(selectPaymentIntentNetworkEngine).toHaveBeenCalledWith({
      intentId: "intent-1",
      network: "solana",
      asset: "USDC",
      idempotencyKey: "intent-1-usdc",
    })
  })
})
