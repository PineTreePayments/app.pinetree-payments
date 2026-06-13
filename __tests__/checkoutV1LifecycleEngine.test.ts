import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getCheckoutLinkById,
  updateActiveCheckoutLinkLifecycle,
  getPublicCheckoutSession,
} = vi.hoisted(() => ({
  getCheckoutLinkById: vi.fn(),
  updateActiveCheckoutLinkLifecycle: vi.fn(),
  getPublicCheckoutSession: vi.fn(),
}))

vi.mock("@/database/checkoutLinks", () => ({
  getCheckoutLinkById,
  updateActiveCheckoutLinkLifecycle,
}))

vi.mock("@/engine/publicCheckoutSessions", () => ({
  getPublicCheckoutSession,
}))

vi.mock("@/engine/webhookDelivery", () => ({
  deliverV1CheckoutSessionWebhook: vi.fn().mockResolvedValue(undefined),
}))

import {
  CheckoutSessionLifecycleError,
  transitionCheckoutSessionLifecycle,
} from "@/engine/checkoutSessionLifecycle"

const openSession = {
  id: "session-1",
  object: "checkout.session" as const,
  status: "open" as const,
  amount: 49.99,
  currency: "USD",
  reference: "order-1",
  customer: { email: null },
  metadata: { cartId: "cart-1" },
  checkoutUrl: "https://example.test/checkout/token",
  paymentId: null,
  supportedRails: ["base"],
  successUrl: null,
  cancelUrl: null,
  createdAt: "2026-06-12T00:00:00.000Z",
  expiresAt: "2026-06-13T00:00:00.000Z",
}

const link = {
  id: "session-1",
  merchant_id: "merchant-1",
  status: "active",
  link_metadata: { cartId: "cart-1" },
}

describe("v1 checkout session lifecycle engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCheckoutLinkById.mockResolvedValue(link)
    updateActiveCheckoutLinkLifecycle.mockResolvedValue({
      ...link,
      status: "disabled",
    })
  })

  it("cancels an open session and returns canceled", async () => {
    getPublicCheckoutSession
      .mockResolvedValueOnce(openSession)
      .mockResolvedValueOnce({ ...openSession, status: "canceled" })

    await expect(
      transitionCheckoutSessionLifecycle({
        merchantId: "merchant-1",
        sessionId: "session-1",
        lifecycle: "canceled",
      })
    ).resolves.toMatchObject({ status: "canceled" })

    expect(updateActiveCheckoutLinkLifecycle).toHaveBeenCalledWith(
      "session-1",
      "merchant-1",
      {
        metadata: {
          cartId: "cart-1",
          _pinetree_session_lifecycle: "canceled",
        },
      }
    )
  })

  it("does not cancel a paid session", async () => {
    getPublicCheckoutSession.mockResolvedValue({
      ...openSession,
      status: "paid",
      paymentId: "payment-1",
    })

    await expect(
      transitionCheckoutSessionLifecycle({
        merchantId: "merchant-1",
        sessionId: "session-1",
        lifecycle: "canceled",
      })
    ).rejects.toBeInstanceOf(CheckoutSessionLifecycleError)
    expect(updateActiveCheckoutLinkLifecycle).not.toHaveBeenCalled()
  })

  it("expires an open session and returns expired", async () => {
    getPublicCheckoutSession
      .mockResolvedValueOnce(openSession)
      .mockResolvedValueOnce({ ...openSession, status: "expired" })

    await expect(
      transitionCheckoutSessionLifecycle({
        merchantId: "merchant-1",
        sessionId: "session-1",
        lifecycle: "expired",
      })
    ).resolves.toMatchObject({ status: "expired" })

    expect(updateActiveCheckoutLinkLifecycle).toHaveBeenCalledWith(
      "session-1",
      "merchant-1",
      expect.objectContaining({
        expiresAt: expect.any(String),
        metadata: {
          cartId: "cart-1",
          _pinetree_session_lifecycle: "expired",
        },
      })
    )
  })

  it("does not expire a paid session", async () => {
    getPublicCheckoutSession.mockResolvedValue({
      ...openSession,
      status: "paid",
      paymentId: "payment-1",
    })

    await expect(
      transitionCheckoutSessionLifecycle({
        merchantId: "merchant-1",
        sessionId: "session-1",
        lifecycle: "expired",
      })
    ).rejects.toBeInstanceOf(CheckoutSessionLifecycleError)
    expect(updateActiveCheckoutLinkLifecycle).not.toHaveBeenCalled()
  })
})
