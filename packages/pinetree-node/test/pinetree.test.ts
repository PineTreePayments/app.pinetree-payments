import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PineTree, {
  AuthenticationError,
  IdempotencyConflictError,
  InvalidRequestError,
  WebhookVerificationError,
  WEBHOOK_SCHEMA,
  WEBHOOK_SCHEMA_HEADER,
  LEGACY_SCHEMA_HEADER,
  PineTreeWebhookHeaders,
} from "../src"

const session = {
  id: "session-1",
  object: "checkout.session",
  status: "open",
  amount: 1000,
  currency: "USD",
  reference: null,
  customer: { email: null },
  metadata: {},
  checkoutUrl: "https://app.pinetree-payments.com/checkout/token",
  paymentId: null,
  supportedRails: ["base"],
  successUrl: null,
  cancelUrl: null,
  createdAt: "2026-06-12T00:00:00.000Z",
  expiresAt: null,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("PineTree Node SDK", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("creates a checkout session with auth and idempotency", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(session, 201)))
    const pinetree = new PineTree({
      apiKey: "pt_live_test",
      baseUrl: "https://api.test/",
      timeout: 5000,
    })

    await expect(
      pinetree.checkout.sessions.create(
        {
          amount: 1000,
          currency: "USD",
          customer: { email: "buyer@example.com" },
          metadata: { orderType: "online" },
          rails: ["base"],
          successUrl: "https://shop.test/success",
          cancelUrl: "https://shop.test/cancel",
        },
        { idempotencyKey: "order-1" }
      )
    ).resolves.toEqual(session)

    const [url, request] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe("https://api.test/api/v1/checkout/sessions")
    expect(request?.method).toBe("POST")
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer pt_live_test",
      "Idempotency-Key": "order-1",
      "User-Agent": "@pinetreepayments/node/0.1.0",
    })
  })

  it("retrieves a checkout session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(session)))
    const result = await new PineTree("pt_live_test").checkout.sessions.retrieve("session/1")
    expect(result.id).toBe("session-1")
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("session%2F1")
  })

  it("lists checkout sessions with public query names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ object: "list", data: [session], hasMore: false, nextCursor: null })
      )
    )
    await new PineTree("pt_live_test").checkout.sessions.list({
      limit: 25,
      status: "paid",
      startingAfter: "cursor-1",
      createdAfter: "2026-06-01",
    })
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]))
    expect(url.searchParams.get("starting_after")).toBe("cursor-1")
    expect(url.searchParams.get("created_after")).toBe("2026-06-01")
  })

  it("cancels a checkout session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...session, status: "canceled" })))
    const result = await new PineTree("pt_live_test").checkout.sessions.cancel("session-1")
    expect(result.status).toBe("canceled")
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/session-1/cancel")
  })

  it("expires a checkout session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...session, status: "expired" })))
    const result = await new PineTree("pt_live_test").checkout.sessions.expire("session-1")
    expect(result.status).toBe("expired")
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/session-1/expire")
  })

  it("retrieves a public payment", async () => {
    const payment = { id: "payment-1", object: "payment", status: "paid" }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payment)))
    await expect(
      new PineTree("pt_live_test").payments.retrieve("payment-1")
    ).resolves.toMatchObject(payment)
  })

  it("lists webhook deliveries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ object: "list", data: [], hasMore: false, nextCursor: null })
      )
    )
    await new PineTree("pt_live_test").webhookDeliveries.list({
      status: "failed",
      eventType: "checkout.session.failed",
    })
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]))
    expect(url.searchParams.get("eventType")).toBe("checkout.session.failed")
  })

  it("retries a webhook delivery", async () => {
    const delivery = {
      id: "delivery-1",
      object: "webhook.delivery",
      status: "delivered",
      attemptCount: 2,
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(delivery)))
    await expect(
      new PineTree("pt_live_test").webhookDeliveries.retry("delivery-1")
    ).resolves.toMatchObject(delivery)
  })

  it("constructs and verifies a v1 webhook event", () => {
    const event = {
      eventId: "evt_1",
      object: "event",
      type: "checkout.session.completed",
      schema: "payments-v1",
      createdAt: new Date().toISOString(),
      livemode: true,
      data: { object: { ...session, status: "paid" } },
    }
    const rawBody = JSON.stringify(event)
    const secret = "whsec_test"
    const signature = `sha256=${createHmac("sha256", secret)
      .update(`${event.createdAt}.`)
      .update(rawBody)
      .digest("hex")}`

    expect(
      new PineTree("pt_live_test").webhooks.constructEvent(
        rawBody,
        signature,
        event.createdAt,
        secret
      )
    ).toEqual(event)
  })

  it("throws a typed webhook verification error", () => {
    expect(() =>
      new PineTree("pt_live_test").webhooks.constructEvent(
        JSON.stringify({
          eventId: "evt_1",
          object: "event",
          type: "checkout.session.completed",
          schema: "payments-v1",
          createdAt: new Date().toISOString(),
          livemode: true,
          data: { object: session },
        }),
        "sha256=invalid",
        new Date().toISOString(),
        "wrong"
      )
    ).toThrow(WebhookVerificationError)
  })

  it("constructs an event from Node-style headers", () => {
    const timestamp = new Date().toISOString()
    const event = {
      eventId: "evt_headers",
      object: "event",
      type: "checkout.session.completed",
      schema: "payments-v1",
      createdAt: timestamp,
      livemode: true,
      data: { object: session },
    }
    const rawBody = JSON.stringify(event)
    const secret = "whsec_headers"
    const signature = `sha256=${createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex")}`

    expect(
      new PineTree("pt_live_test").webhooks.constructEvent(
        rawBody,
        {
          "pinetree-signature": signature,
          "PineTree-Timestamp": [timestamp],
          "pinetree-event-id": "evt_headers",
          "pinetree-webhook-version": "payments-v1",
        },
        secret
      )
    ).toEqual(event)
  })

  it("normalizes legacy checkout.session.paid events to completed", () => {
    const timestamp = new Date().toISOString()
    const legacyEvent = {
      eventId: "evt_legacy_paid",
      object: "event",
      type: "checkout.session.paid",
      schema: "payments-v1",
      createdAt: timestamp,
      livemode: true,
      data: { object: session },
    }
    const rawBody = JSON.stringify(legacyEvent)
    const secret = "whsec_legacy_paid"
    const signature = `sha256=${createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex")}`

    expect(
      new PineTree("pt_live_test").webhooks.constructEvent(
        rawBody,
        signature,
        timestamp,
        secret
      )
    ).toMatchObject({
      ...legacyEvent,
      type: "checkout.session.completed",
    })
  })

  it("maps API authentication and invalid request errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          jsonResponse({
            error: {
              type: "authentication_error",
              code: "invalid_api_key",
              message: "Invalid key",
            },
          }, 401)
        )
        .mockResolvedValueOnce(
          jsonResponse({
            error: {
              type: "invalid_request_error",
              code: "invalid_filter",
              message: "Invalid filter",
            },
          }, 400)
        )
    )
    const pinetree = new PineTree("pt_live_test")
    await expect(pinetree.payments.retrieve("one")).rejects.toBeInstanceOf(AuthenticationError)
    await expect(pinetree.payments.retrieve("two")).rejects.toBeInstanceOf(InvalidRequestError)
  })

  it("maps idempotency conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          error: {
            type: "idempotency_error",
            code: "idempotency_key_conflict",
            message: "Key reused",
          },
        }, 409)
      )
    )
    await expect(
      new PineTree("pt_live_test").checkout.sessions.create(
        { amount: 1000 },
        { idempotencyKey: "order-1" }
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it("accepts PineTree-Event-Schema (canonical) header in constructEvent", () => {
    const timestamp = new Date().toISOString()
    const event = {
      eventId: "evt_schema",
      object: "event",
      type: "payment.confirmed",
      schema: "payments-v1",
      createdAt: timestamp,
      livemode: true,
      data: { object: { id: "pay_1", object: "payment" } },
    }
    const rawBody = JSON.stringify(event)
    const secret = "whsec_schema"
    const sig = `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`

    const result = new PineTree("pt_live_test").webhooks.constructEvent(
      rawBody,
      { "PineTree-Signature": sig, "PineTree-Timestamp": timestamp, [WEBHOOK_SCHEMA_HEADER]: WEBHOOK_SCHEMA },
      secret
    )
    expect(result.eventId).toBe("evt_schema")
  })

  it("accepts legacy PineTree-Webhook-Version header in constructEvent", () => {
    const timestamp = new Date().toISOString()
    const event = {
      eventId: "evt_legacy",
      object: "event",
      type: "payment.confirmed",
      schema: "payments-v1",
      createdAt: timestamp,
      livemode: true,
      data: { object: { id: "pay_2", object: "payment" } },
    }
    const rawBody = JSON.stringify(event)
    const secret = "whsec_legacy"
    const sig = `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`

    const result = new PineTree("pt_live_test").webhooks.constructEvent(
      rawBody,
      { "PineTree-Signature": sig, "PineTree-Timestamp": timestamp, [LEGACY_SCHEMA_HEADER]: WEBHOOK_SCHEMA },
      secret
    )
    expect(result.eventId).toBe("evt_legacy")
  })

  it("accepts dual headers (canonical + legacy) simultaneously", () => {
    const timestamp = new Date().toISOString()
    const event = {
      eventId: "evt_dual",
      object: "event",
      type: "checkout.session.completed",
      schema: "payments-v1",
      createdAt: timestamp,
      livemode: false,
      data: { object: { id: "cs_1", object: "checkout.session", status: "paid" } },
    }
    const rawBody = JSON.stringify(event)
    const secret = "whsec_dual"
    const sig = `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`

    const result = new PineTree("pt_live_test").webhooks.constructEvent(
      rawBody,
      {
        "PineTree-Signature": sig,
        "PineTree-Timestamp": timestamp,
        [WEBHOOK_SCHEMA_HEADER]: WEBHOOK_SCHEMA,
        [LEGACY_SCHEMA_HEADER]: WEBHOOK_SCHEMA,
      },
      secret
    )
    expect(result.type).toBe("checkout.session.completed")
  })

  it("PineTreeWebhookHeaders exposes schema and version fields pointing to correct header names", () => {
    expect(PineTreeWebhookHeaders.schema).toBe(WEBHOOK_SCHEMA_HEADER)
    expect(PineTreeWebhookHeaders.version).toBe(LEGACY_SCHEMA_HEADER)
    expect(WEBHOOK_SCHEMA_HEADER).toBe("PineTree-Event-Schema")
    expect(LEGACY_SCHEMA_HEADER).toBe("PineTree-Webhook-Version")
  })
})
