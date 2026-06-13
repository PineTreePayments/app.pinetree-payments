import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  requireV1MerchantApiKey,
  requireV1MerchantApiKeyWithAnyPermission,
  createCheckoutSessionEngine,
  getPublicCheckoutSession,
  buildCheckoutSessionIdempotency,
  claimCheckoutSessionIdempotency,
  completeCheckoutSessionIdempotency,
  releaseCheckoutSessionIdempotency,
} = vi.hoisted(() => ({
  requireV1MerchantApiKey: vi.fn(),
  requireV1MerchantApiKeyWithAnyPermission: vi.fn(),
  createCheckoutSessionEngine: vi.fn(),
  getPublicCheckoutSession: vi.fn(),
  buildCheckoutSessionIdempotency: vi.fn(),
  claimCheckoutSessionIdempotency: vi.fn(),
  completeCheckoutSessionIdempotency: vi.fn(),
  releaseCheckoutSessionIdempotency: vi.fn(),
}))

vi.mock("@/lib/api/v1/auth", () => ({
  requireV1MerchantApiKey,
  requireV1MerchantApiKeyWithAnyPermission,
}))

vi.mock("@/engine/checkoutSessions", () => ({
  createCheckoutSessionEngine,
}))

vi.mock("@/engine/publicCheckoutSessions", () => ({
  getPublicCheckoutSession,
}))

vi.mock("@/engine/checkoutSessionIdempotency", () => ({
  buildCheckoutSessionIdempotency,
  claimCheckoutSessionIdempotency,
  completeCheckoutSessionIdempotency,
  releaseCheckoutSessionIdempotency,
}))

vi.mock("@/engine/webhookDelivery", () => ({
  deliverV1CheckoutSessionWebhook: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/v1/checkout/sessions/route"
import { GET } from "@/app/api/v1/checkout/sessions/[id]/route"

const normalizedSession = {
  id: "session-1",
  object: "checkout.session" as const,
  status: "open" as const,
  amount: 49.99,
  currency: "USD",
  reference: "order-1042",
  customer: { email: "customer@example.com" },
  metadata: { cartId: "cart-1" },
  checkoutUrl: "https://app.pinetree-payments.com/checkout/token-1",
  paymentId: null,
  supportedRails: ["base", "solana"],
  successUrl: "https://merchant.test/success",
  cancelUrl: "https://merchant.test/cancel",
  createdAt: "2026-06-12T12:00:00.000Z",
  expiresAt: "2026-06-13T12:00:00.000Z",
}

describe("v1 checkout session routes", () => {
  beforeEach(() => {
    requireV1MerchantApiKey.mockReset()
    requireV1MerchantApiKeyWithAnyPermission.mockReset()
    createCheckoutSessionEngine.mockReset()
    getPublicCheckoutSession.mockReset()
    buildCheckoutSessionIdempotency.mockReset()
    claimCheckoutSessionIdempotency.mockReset()
    completeCheckoutSessionIdempotency.mockReset()
    releaseCheckoutSessionIdempotency.mockReset()
    requireV1MerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["checkout.sessions:create"],
    })
    requireV1MerchantApiKeyWithAnyPermission.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["checkout.sessions:read"],
    })
  })

  it("creates and returns a normalized checkout session with metadata", async () => {
    createCheckoutSessionEngine.mockResolvedValue({
      sessionId: "session-1",
      token: "token-1",
      checkoutUrl: normalizedSession.checkoutUrl,
      amount: 49.99,
      currency: "USD",
      status: "active",
      expiresAt: normalizedSession.expiresAt,
    })
    getPublicCheckoutSession.mockResolvedValue(normalizedSession)

    const req = new NextRequest("https://example.test/api/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer pt_live_valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: 49.99,
        currency: "usd",
        reference: "order-1042",
        customer: { email: "customer@example.com" },
        successUrl: normalizedSession.successUrl,
        cancelUrl: normalizedSession.cancelUrl,
        metadata: { cartId: "cart-1" },
        rails: ["base", "solana"],
      }),
    })

    const response = await POST(req)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(normalizedSession)
    expect(createCheckoutSessionEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        orderId: "order-1042",
        customerEmail: "customer@example.com",
        metadata: expect.objectContaining({
          cartId: "cart-1",
          _pinetree_requested_rails: ["base", "solana"],
        }),
      })
    )
  })

  it("retrieves the same normalized session shape", async () => {
    getPublicCheckoutSession.mockResolvedValue({
      ...normalizedSession,
      status: "paid",
      paymentId: "payment-1",
    })

    const req = new NextRequest("https://example.test/api/v1/checkout/sessions/session-1", {
      headers: { Authorization: "Bearer pt_live_valid" },
    })
    const response = await GET(req, { params: Promise.resolve({ id: "session-1" }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: "session-1",
      object: "checkout.session",
      status: "paid",
      paymentId: "payment-1",
      metadata: { cartId: "cart-1" },
    })
    expect(getPublicCheckoutSession).toHaveBeenCalledWith("merchant-1", "session-1")
    expect(requireV1MerchantApiKeyWithAnyPermission).toHaveBeenCalledWith(
      req,
      ["checkout.sessions:read", "checkout.sessions:create"]
    )
  })

  it("replays the original session for the same idempotency key and body", async () => {
    buildCheckoutSessionIdempotency.mockResolvedValue({
      keyHash: "key-hash-1",
      requestHash: "body-hash-1",
    })
    claimCheckoutSessionIdempotency
      .mockResolvedValueOnce({ state: "claimed", claimId: "claim-1" })
      .mockResolvedValueOnce({ state: "replay", response: normalizedSession })
    createCheckoutSessionEngine.mockResolvedValue({
      sessionId: "session-1",
      token: "token-1",
      checkoutUrl: normalizedSession.checkoutUrl,
      amount: 49.99,
      currency: "USD",
      status: "active",
      expiresAt: normalizedSession.expiresAt,
    })
    getPublicCheckoutSession.mockResolvedValue(normalizedSession)

    const request = () =>
      new NextRequest("https://example.test/api/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: "Bearer pt_live_valid",
          "Content-Type": "application/json",
          "Idempotency-Key": "order-1042",
        },
        body: JSON.stringify({
          amount: 49.99,
          currency: "USD",
          reference: "order-1042",
        }),
      })

    const first = await POST(request())
    const replay = await POST(request())

    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true")
    await expect(replay.json()).resolves.toEqual(normalizedSession)
    expect(createCheckoutSessionEngine).toHaveBeenCalledTimes(1)
    expect(createCheckoutSessionEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        emitLegacyWebhook: false,
      })
    )
    expect(completeCheckoutSessionIdempotency).toHaveBeenCalledWith(
      "claim-1",
      normalizedSession
    )
  })

  it("returns a conflict when an idempotency key is reused with a different body", async () => {
    buildCheckoutSessionIdempotency.mockResolvedValue({
      keyHash: "key-hash-1",
      requestHash: "new-body-hash",
    })
    claimCheckoutSessionIdempotency.mockResolvedValue({ state: "conflict" })

    const req = new NextRequest("https://example.test/api/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer pt_live_valid",
        "Content-Type": "application/json",
        "Idempotency-Key": "order-1042",
      },
      body: JSON.stringify({ amount: 99, currency: "USD" }),
    })

    const response = await POST(req)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: "idempotency_error",
        code: "idempotency_key_conflict",
      },
    })
    expect(createCheckoutSessionEngine).not.toHaveBeenCalled()
  })
})
