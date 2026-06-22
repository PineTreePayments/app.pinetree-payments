import crypto from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildStripePaymentIntentRequest,
  createPayment,
  getPaymentStatus,
  normalizeStripePaymentStatus,
  translateEvent,
  verifyWebhook
} from "@/lib/providers/stripe"

function stripeSignature(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")

  return `t=${timestamp},v1=${signature}`
}

describe("Stripe provider adapter", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("builds documented PaymentIntent body fields", () => {
    expect(buildStripePaymentIntentRequest({
      paymentId: "pay_123",
      merchantAmount: 10,
      pinetreeFee: 0.15,
      grossAmount: 10.15,
      currency: "USD",
      merchantId: "merchant_1"
    })).toEqual({
      amount: 1015,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true
      },
      metadata: {
        paymentId: "pay_123",
        pinetree_payment_id: "pay_123",
        merchantId: "merchant_1",
        pinetree_merchant_id: "merchant_1",
        provider: "stripe",
        network: "stripe"
      }
    })
  })

  it("creates a PaymentIntent with Basic auth and normalizes the response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "pi_123",
        object: "payment_intent",
        amount: 1015,
        currency: "usd",
        client_secret: "pi_123_secret_abc",
        status: "requires_payment_method"
      })
    })
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123")
    vi.stubGlobal("fetch", fetchSpy)

    await expect(createPayment({
      paymentId: "pay_123",
      merchantAmount: 10,
      pinetreeFee: 0.15,
      grossAmount: 10.15,
      currency: "USD",
      merchantId: "merchant_1",
      stripeConnectedAccountId: "acct_123"
    })).resolves.toMatchObject({
      provider: "stripe",
      providerReference: "pi_123",
      clientSecret: "pi_123_secret_abc",
      amount: 1015,
      currency: "usd",
      status: "PENDING",
      feeCaptureMethod: "collection_then_settle"
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/payment_intents",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("sk_test_123:").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "pay_123",
          "Stripe-Account": "acct_123"
        })
      })
    )

    const body = fetchSpy.mock.calls[0][1].body as URLSearchParams
    expect(body.get("amount")).toBe("1015")
    expect(body.get("currency")).toBe("usd")
    expect(body.get("automatic_payment_methods[enabled]")).toBe("true")
    expect(body.get("metadata[paymentId]")).toBe("pay_123")
    expect(body.get("metadata[merchantId]")).toBe("merchant_1")
    expect(body.get("metadata[provider]")).toBe("stripe")
    expect(body.get("metadata[network]")).toBe("stripe")
  })

  it("blocks createPayment before a real API call when the Stripe secret key is missing", async () => {
    const fetchSpy = vi.fn()
    vi.stubEnv("STRIPE_SECRET_KEY", "")
    vi.stubGlobal("fetch", fetchSpy)

    await expect(createPayment({
      paymentId: "pay_123",
      merchantAmount: 10,
      pinetreeFee: 0.15,
      grossAmount: 10.15,
      currency: "USD",
      merchantId: "merchant_1"
    })).rejects.toThrow("Stripe secret key not configured")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["requires_payment_method", "PENDING"],
    ["requires_confirmation", "PENDING"],
    ["requires_action", "PROCESSING"],
    ["processing", "PROCESSING"],
    ["requires_capture", "PROCESSING"],
    ["succeeded", "CONFIRMED"],
    ["canceled", "FAILED"],
    ["unknown", "PENDING"]
  ] as const)("normalizes %s to %s", (providerStatus, expectedStatus) => {
    expect(normalizeStripePaymentStatus(providerStatus)).toBe(expectedStatus)
  })

  it("retrieves and normalizes PaymentIntent status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "pi_123",
        status: "succeeded"
      })
    })
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123")
    vi.stubGlobal("fetch", fetchSpy)

    await expect(getPaymentStatus("pi_123")).resolves.toMatchObject({
      provider: "stripe",
      providerReference: "pi_123",
      status: "CONFIRMED"
    })
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.stripe.com/v1/payment_intents/pi_123")
  })

  it("accepts valid documented webhook signatures", () => {
    const rawBody = JSON.stringify({ id: "evt_123", type: "payment_intent.succeeded" })
    const secret = "whsec_test_123"

    expect(verifyWebhook({
      rawBody,
      webhookSecret: secret,
      headers: {
        "Stripe-Signature": stripeSignature(rawBody, secret)
      }
    })).toBe(true)
  })

  it("rejects invalid and unsigned webhook signatures", () => {
    const rawBody = JSON.stringify({ id: "evt_123", type: "payment_intent.succeeded" })

    expect(verifyWebhook({
      rawBody,
      webhookSecret: "whsec_test_123",
      headers: {
        "Stripe-Signature": "t=123,v1=bad"
      }
    })).toBe(false)
    expect(verifyWebhook({ rawBody, webhookSecret: "whsec_test_123", headers: {} })).toBe(false)
  })

  it("rejects stale webhook signatures", () => {
    const rawBody = JSON.stringify({ id: "evt_123", type: "payment_intent.succeeded" })
    const secret = "whsec_test_123"
    const timestamp = 1000

    expect(verifyWebhook({
      rawBody,
      webhookSecret: secret,
      now: timestamp + 301,
      headers: {
        "Stripe-Signature": stripeSignature(rawBody, secret, timestamp)
      }
    })).toBe(false)
  })

  it.each([
    ["payment_intent.created", "payment.created"],
    ["payment_intent.processing", "payment.processing"],
    ["payment_intent.succeeded", "payment.confirmed"],
    ["payment_intent.payment_failed", "payment.failed"],
    ["payment_intent.canceled", "payment.failed"]
  ] as const)("translates %s to %s", (providerEvent, expectedEvent) => {
    expect(translateEvent({
      id: "evt_123",
      type: providerEvent,
      data: {
        object: {
          id: "pi_123",
          metadata: {
            paymentId: "pay_123"
          }
        }
      }
    })).toMatchObject({
      provider: "stripe",
      providerReference: "pi_123",
      providerEvent,
      paymentId: "pay_123",
      event: expectedEvent
    })
  })
})
