import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  requireV1MerchantApiKey,
  listPublicCheckoutSessions,
} = vi.hoisted(() => ({
  requireV1MerchantApiKey: vi.fn(),
  listPublicCheckoutSessions: vi.fn(),
}))

vi.mock("@/lib/api/v1/auth", () => ({ requireV1MerchantApiKey }))
vi.mock("@/engine/publicCheckoutSessions", () => ({
  getPublicCheckoutSession: vi.fn(),
  listPublicCheckoutSessions,
}))
vi.mock("@/engine/checkoutSessions", () => ({
  createCheckoutSessionEngine: vi.fn(),
}))
vi.mock("@/engine/checkoutSessionIdempotency", () => ({
  buildCheckoutSessionIdempotency: vi.fn(),
  claimCheckoutSessionIdempotency: vi.fn(),
  completeCheckoutSessionIdempotency: vi.fn(),
  releaseCheckoutSessionIdempotency: vi.fn(),
}))
vi.mock("@/engine/webhookDelivery", () => ({
  deliverV1CheckoutSessionWebhook: vi.fn(),
}))

import { GET } from "@/app/api/v1/checkout/sessions/route"

describe("v1 checkout session list route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireV1MerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      permissions: ["checkout.sessions:read"],
    })
    listPublicCheckoutSessions.mockResolvedValue({
      data: [],
      hasMore: false,
      nextCursor: null,
    })
  })

  it("passes merchant-scoped filters and pagination to the listing engine", async () => {
    const request = new NextRequest(
      "https://example.test/api/v1/checkout/sessions?limit=20&status=paid&reference=order-1"
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [],
      hasMore: false,
      nextCursor: null,
    })
    expect(requireV1MerchantApiKey).toHaveBeenCalledWith(
      request,
      "checkout.sessions:read"
    )
    expect(listPublicCheckoutSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        limit: 20,
        status: "paid",
        reference: "order-1",
      })
    )
  })
})
