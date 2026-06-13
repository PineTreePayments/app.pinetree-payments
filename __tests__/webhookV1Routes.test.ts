import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  requireV1MerchantApiKey,
  retryWebhookDelivery,
  listPublicWebhookDeliveries,
} = vi.hoisted(() => ({
  requireV1MerchantApiKey: vi.fn(),
  retryWebhookDelivery: vi.fn(),
  listPublicWebhookDeliveries: vi.fn(),
}))

vi.mock("@/lib/api/v1/auth", () => ({ requireV1MerchantApiKey }))
vi.mock("@/engine/webhookDelivery", () => ({ retryWebhookDelivery }))
vi.mock("@/engine/publicWebhookDeliveries", () => ({
  normalizePublicWebhookDelivery: (delivery: Record<string, unknown>) => ({
    id: delivery.id,
    object: "webhook.delivery",
    status: delivery.status,
    attemptCount: delivery.attempt_count,
  }),
  listPublicWebhookDeliveries,
}))

import { POST as retry } from "@/app/api/v1/webhook-deliveries/[id]/retry/route"
import { GET as list } from "@/app/api/v1/webhook-deliveries/route"

describe("v1 webhook delivery routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireV1MerchantApiKey.mockResolvedValue({ merchantId: "merchant-1" })
  })

  it("manually retries a merchant delivery", async () => {
    retryWebhookDelivery.mockResolvedValue({
      id: "delivery-1",
      status: "delivered",
      attempt_count: 2,
    })
    const request = new NextRequest(
      "https://example.test/api/v1/webhook-deliveries/delivery-1/retry",
      { method: "POST", headers: { Authorization: "Bearer pt_live_valid" } }
    )
    const response = await retry(request, {
      params: Promise.resolve({ id: "delivery-1" }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: "webhook.delivery",
      status: "delivered",
      attemptCount: 2,
    })
    expect(requireV1MerchantApiKey).toHaveBeenCalledWith(request, "webhooks:write")
  })

  it("rejects cross-merchant delivery access as not found", async () => {
    retryWebhookDelivery.mockResolvedValue(null)
    const request = new NextRequest(
      "https://example.test/api/v1/webhook-deliveries/other/retry",
      { method: "POST", headers: { Authorization: "Bearer pt_live_valid" } }
    )
    const response = await retry(request, {
      params: Promise.resolve({ id: "other" }),
    })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "webhook_delivery_not_found" },
    })
    expect(retryWebhookDelivery).toHaveBeenCalledWith("merchant-1", "other")
  })

  it("lists merchant-scoped deliveries with filters and pagination", async () => {
    listPublicWebhookDeliveries.mockResolvedValue({
      data: [],
      hasMore: true,
      nextCursor: "next-1",
    })
    const request = new NextRequest(
      "https://example.test/api/v1/webhook-deliveries?limit=10&status=failed&eventType=checkout.session.paid"
    )
    const response = await list(request)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [],
      hasMore: true,
      nextCursor: "next-1",
    })
    expect(listPublicWebhookDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        limit: 10,
        status: "failed",
        eventType: "checkout.session.paid",
      })
    )
  })
})
