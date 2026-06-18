import { describe, expect, it, vi } from "vitest"

vi.mock("@/database/merchantWebhooks", () => ({
  getMerchantWebhook: vi.fn(),
  insertWebhookDelivery: vi.fn(),
}))

import { buildV1CheckoutSessionEvent } from "@/engine/webhookDelivery"

describe("v1 checkout session webhook normalization", () => {
  it("wraps the normalized session object in the public event contract", () => {
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
    const event = buildV1CheckoutSessionEvent(
      "checkout.session.completed",
      session,
      "2026-06-12T01:00:00.000Z"
    )
    expect(event).toMatchObject({
      eventId: expect.stringMatching(/^evt_/),
      object: "event",
      type: "checkout.session.completed",
      schema: "payments-v1",
      createdAt: "2026-06-12T01:00:00.000Z",
      data: { object: session },
    })
  })
})
