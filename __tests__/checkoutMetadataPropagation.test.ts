import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getCheckoutLinkByPublicToken,
  createPaymentIntentEngine,
} = vi.hoisted(() => ({
  getCheckoutLinkByPublicToken: vi.fn(),
  createPaymentIntentEngine: vi.fn(),
}))

vi.mock("@/database/checkoutLinks", () => ({
  getCheckoutLinkByPublicToken,
  insertCheckoutLink: vi.fn(),
  getCheckoutLinksByMerchant: vi.fn(),
  updateCheckoutLinkStatus: vi.fn(),
}))

vi.mock("@/engine/paymentIntents", () => ({
  createPaymentIntentEngine,
}))

import { resolveCheckoutLinkForCustomer } from "@/engine/checkoutLinks"

describe("checkout metadata propagation", () => {
  beforeEach(() => {
    getCheckoutLinkByPublicToken.mockReset()
    createPaymentIntentEngine.mockReset()
  })

  it("carries session metadata and requested rails into the payment intent", async () => {
    getCheckoutLinkByPublicToken.mockResolvedValue({
      id: "session-1",
      merchant_id: "merchant-1",
      public_token: "token-1",
      name: "Order order-1",
      description: null,
      amount: 42,
      currency: "USD",
      customer_email: "customer@example.com",
      reference: "order-1",
      status: "active",
      expires_at: "2099-01-01T00:00:00.000Z",
      success_url: "https://merchant.test/success",
      cancel_url: "https://merchant.test/cancel",
      link_metadata: {
        cartId: "cart-1",
        _pinetree_requested_rails: ["base"],
      },
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    })
    createPaymentIntentEngine.mockResolvedValue({ intentId: "intent-1" })

    await resolveCheckoutLinkForCustomer("token-1")

    expect(createPaymentIntentEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        allowedNetworks: ["base"],
        metadata: expect.objectContaining({
          cartId: "cart-1",
          checkoutLinkId: "session-1",
          reference: "order-1",
        }),
      })
    )
  })
})
