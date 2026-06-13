import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createCheckoutLinkEngine: vi.fn(),
  deliverWebhook: vi.fn(),
}))

vi.mock("@/engine/checkoutLinks", () => ({
  createCheckoutLinkEngine: mocks.createCheckoutLinkEngine,
}))

vi.mock("@/engine/webhookDelivery", () => ({
  deliverWebhook: mocks.deliverWebhook,
}))

import { createCheckoutSessionEngine } from "@/engine/checkoutSessions"

describe("checkout session metadata persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCheckoutLinkEngine.mockResolvedValue({
      id: "link_123",
      url: "https://checkout.example/link_123",
      expires_at: null,
    })
    mocks.deliverWebhook.mockResolvedValue(undefined)
  })

  it("persists internal rail metadata but omits it from webhook metadata", async () => {
    await createCheckoutSessionEngine({
      merchantId: "merchant_123",
      amount: 2500,
      currency: "usd",
      metadata: {
        cartId: "cart_123",
        _pinetree_requested_rails: ["base"],
      },
    })

    expect(mocks.createCheckoutLinkEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          cartId: "cart_123",
          _pinetree_requested_rails: ["base"],
          channel: "online",
        },
      }),
    )
    expect(mocks.deliverWebhook).toHaveBeenCalledWith(
      "merchant_123",
      "checkout.session.created",
      expect.objectContaining({
        metadata: {
          cartId: "cart_123",
          channel: "online",
        },
      }),
    )
  })
})
