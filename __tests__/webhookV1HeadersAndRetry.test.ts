import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getMerchantWebhook,
  getMerchantWebhookById,
  getWebhookDeliveryById,
  insertWebhookDelivery,
  listRetryEligibleWebhookDeliveries,
  updateWebhookDeliveryAttempt,
} = vi.hoisted(() => ({
  getMerchantWebhook: vi.fn(),
  getMerchantWebhookById: vi.fn(),
  getWebhookDeliveryById: vi.fn(),
  insertWebhookDelivery: vi.fn(),
  listRetryEligibleWebhookDeliveries: vi.fn(),
  updateWebhookDeliveryAttempt: vi.fn(),
}))

vi.mock("@/database/merchantWebhooks", () => ({
  getMerchantWebhook,
  getMerchantWebhookById,
  getWebhookDeliveryById,
  insertWebhookDelivery,
  listRetryEligibleWebhookDeliveries,
  updateWebhookDeliveryAttempt,
}))

import {
  deliverWebhook,
  deliverV1CheckoutSessionWebhook,
  retryWebhookDelivery,
  V1_WEBHOOK_VERSION,
} from "@/engine/webhookDelivery"

const config = {
  id: "webhook-1",
  merchant_id: "merchant-1",
  url: "https://merchant.test/webhooks",
  secret: "secret-1",
  events: ["checkout.session.paid", "payment.confirmed"],
  enabled: true,
}

const session = {
  id: "session-1",
  object: "checkout.session" as const,
  status: "paid" as const,
  amount: 10,
  currency: "USD",
  reference: "order-1",
  customer: { email: null },
  metadata: {},
  checkoutUrl: "https://example.test/checkout/token",
  paymentId: "payment-1",
  supportedRails: ["base"],
  successUrl: null,
  cancelUrl: null,
  createdAt: "2026-06-12T00:00:00.000Z",
  expiresAt: null,
}

describe("v1 webhook headers and retry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue("ok"),
      })
    )
    getMerchantWebhook.mockResolvedValue(config)
    insertWebhookDelivery.mockResolvedValue(null)
  })

  it("sends stable v1 headers while retaining legacy headers", async () => {
    await deliverV1CheckoutSessionWebhook(
      "merchant-1",
      "checkout.session.paid",
      session
    )

    const request = vi.mocked(fetch).mock.calls[0][1]
    const headers = request?.headers as Record<string, string>
    expect(headers["PineTree-Signature"]).toMatch(/^sha256=/)
    expect(headers["PineTree-Timestamp"]).toBeTruthy()
    expect(headers["PineTree-Event-Id"]).toMatch(/^evt_/)
    expect(headers["PineTree-Webhook-Version"]).toBe(V1_WEBHOOK_VERSION)
    expect(headers["X-PineTree-Signature"]).toBe(headers["PineTree-Signature"])
    expect(headers["X-PineTree-Timestamp"]).toBe(headers["PineTree-Timestamp"])
  })

  it("keeps legacy webhook headers working", async () => {
    await deliverWebhook("merchant-1", "payment.confirmed", {
      paymentId: "payment-1",
      merchantId: "merchant-1",
      amount: 10,
      currency: "USD",
      status: "CONFIRMED",
    })
    const request = vi.mocked(fetch).mock.calls[0][1]
    const headers = request?.headers as Record<string, string>
    expect(headers["X-PineTree-Signature"]).toMatch(/^sha256=/)
    expect(headers["X-PineTree-Timestamp"]).toBeTruthy()
  })

  it("redelivers a stored failed event and increments durable attempts", async () => {
    const payload = {
      eventId: "evt_stored",
      type: "checkout.session.paid",
      createdAt: "2026-06-12T01:00:00.000Z",
      data: { object: session },
    }
    getWebhookDeliveryById.mockResolvedValue({
      id: "delivery-1",
      merchant_id: "merchant-1",
      webhook_id: "webhook-1",
      event: "checkout.session.paid",
      payload,
      status: "failed",
      attempt_count: 1,
    })
    getMerchantWebhookById.mockResolvedValue(config)
    updateWebhookDeliveryAttempt.mockResolvedValue({
      id: "delivery-1",
      merchant_id: "merchant-1",
      webhook_id: "webhook-1",
      event: "checkout.session.paid",
      payload,
      status: "delivered",
      attempt_count: 2,
    })

    await expect(
      retryWebhookDelivery("merchant-1", "delivery-1")
    ).resolves.toMatchObject({ status: "delivered", attempt_count: 2 })
    expect(updateWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "delivery-1",
        merchantId: "merchant-1",
        status: "delivered",
        attemptCount: 2,
      })
    )
  })
})
