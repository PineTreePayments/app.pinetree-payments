import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  verifyMerchantPublicKey,
  createCheckoutSessionEngine,
  getPublicCheckoutSession,
  normalizeCheckoutSessionRails,
} = vi.hoisted(() => ({
  verifyMerchantPublicKey: vi.fn(),
  createCheckoutSessionEngine: vi.fn(),
  getPublicCheckoutSession: vi.fn(),
  normalizeCheckoutSessionRails: vi.fn(),
}))

vi.mock("@/engine/merchantPublicKeys", () => ({ verifyMerchantPublicKey }))
vi.mock("@/engine/checkoutSessions", () => ({ createCheckoutSessionEngine }))
vi.mock("@/engine/publicCheckoutSessions", () => ({ getPublicCheckoutSession }))
vi.mock("@/engine/checkoutSessionMetadata", () => ({
  CHECKOUT_SESSION_RAILS_METADATA_KEY: "_rails",
  normalizeCheckoutSessionRails,
}))
vi.mock("@/engine/webhookDelivery", () => ({
  deliverV1CheckoutSessionWebhook: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/v1/browser/checkout/sessions/route"

const normalizedSession = {
  id: "session-1",
  object: "checkout.session" as const,
  status: "open",
  amount: 49.99,
  currency: "USD",
  reference: "order-1042",
  customer: { email: null },
  metadata: {},
  checkoutUrl: "https://app.pinetree-payments.com/checkout/token-1",
  paymentId: null,
  supportedRails: ["base", "solana"],
  successUrl: null,
  cancelUrl: null,
  createdAt: "2026-06-13T12:00:00.000Z",
  expiresAt: "2026-06-14T12:00:00.000Z",
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/browser/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/browser/checkout/sessions", () => {
  beforeEach(() => {
    verifyMerchantPublicKey.mockReset()
    createCheckoutSessionEngine.mockReset()
    getPublicCheckoutSession.mockReset()
    normalizeCheckoutSessionRails.mockReset()
    normalizeCheckoutSessionRails.mockReturnValue(undefined)
    verifyMerchantPublicKey.mockResolvedValue({ merchantId: "merchant-1", keyId: "key-1" })
    createCheckoutSessionEngine.mockResolvedValue({ sessionId: "session-1" })
    getPublicCheckoutSession.mockResolvedValue(normalizedSession)
  })

  it("returns 401 when X-PineTree-Public-Key header is missing", async () => {
    const req = makeRequest({ amount: 2500 })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe("missing_public_key")
  })

  it("returns 401 when the public key is invalid", async () => {
    verifyMerchantPublicKey.mockResolvedValue(null)
    const req = makeRequest({ amount: 2500 }, { "X-PineTree-Public-Key": "pk_live_bad" })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe("invalid_public_key")
  })

  it("returns 201 with session on valid request", async () => {
    const req = makeRequest(
      { amount: 2500, currency: "USD" },
      { "X-PineTree-Public-Key": "pk_live_test" }
    )
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("session-1")
    expect(body.checkoutUrl).toBe("https://app.pinetree-payments.com/checkout/token-1")
  })

  it("returns 400 when amount is invalid", async () => {
    const req = makeRequest({ amount: -1 }, { "X-PineTree-Public-Key": "pk_live_test" })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("invalid_amount")
  })

  it("returns 400 when amount is missing", async () => {
    const req = makeRequest({}, { "X-PineTree-Public-Key": "pk_live_test" })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("invalid_amount")
  })

  it("returns 400 when body is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/v1/browser/checkout/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PineTree-Public-Key": "pk_live_test",
      },
      body: "not-json",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("invalid_json")
  })

  it("fires webhook delivery on success", async () => {
    const { deliverV1CheckoutSessionWebhook } = await import("@/engine/webhookDelivery")
    const req = makeRequest({ amount: 2500 }, { "X-PineTree-Public-Key": "pk_live_test" })
    await POST(req)
    expect(deliverV1CheckoutSessionWebhook).toHaveBeenCalledWith(
      "merchant-1",
      "checkout.session.created",
      normalizedSession
    )
  })

  it("passes through optional fields to the checkout engine", async () => {
    const req = makeRequest(
      {
        amount: 9999,
        currency: "EUR",
        reference: "order-xyz",
        customer: { email: "alice@example.com" },
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      },
      { "X-PineTree-Public-Key": "pk_live_test" }
    )
    await POST(req)
    expect(createCheckoutSessionEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9999,
        currency: "EUR",
        orderId: "order-xyz",
        customerEmail: "alice@example.com",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      })
    )
  })
})
