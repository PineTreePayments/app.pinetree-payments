import fs from "fs"
import path from "path"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import {
  createPayment,
  getPaymentStatus,
  translateEvent,
  verifyWebhook
} from "@/providers/shift4"

describe("Shift4 provider adapter", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each([
    ["payment.created", "payment.created"],
    ["payment.pending", "payment.pending"],
    ["payment.authorized", "payment.processing"],
    ["payment.approved", "payment.processing"],
    ["payment.captured", "payment.confirmed"],
    ["payment.settled", "payment.confirmed"],
    ["payment.declined", "payment.failed"],
    ["payment.failed", "payment.failed"],
    ["payment.canceled", "payment.incomplete"],
    ["payment.cancelled", "payment.incomplete"],
    ["CHARGE_PENDING", "payment.pending"],
    ["CHARGE_UPDATED", "payment.processing"],
    ["CHARGE_SUCCEEDED", "payment.confirmed"],
    ["CHARGE_CAPTURED", "payment.confirmed"],
    ["CHARGE_FAILED", "payment.failed"],
  ] as const)("maps %s to %s", (providerEvent, expectedEvent) => {
    expect(
      translateEvent({
        type: providerEvent,
        data: {
          object: {
            id: "pay_shift4_123",
            metadata: { paymentId: "pay_123" }
          }
        }
      })
    ).toMatchObject({
      provider: "shift4",
      providerReference: "pay_shift4_123",
      paymentId: "pay_123",
      providerEvent,
      event: expectedEvent
    })
  })

  it("keeps refunded as a provider event without changing payment state", () => {
    expect(translateEvent({ type: "CHARGE_REFUNDED" })).toBeNull()
    expect(translateEvent({ type: "payment.refunded" })).toBeNull()
  })

  it("keeps voided from incorrectly confirming a new payment", () => {
    expect(translateEvent({ type: "payment.voided" })).toMatchObject({
      event: "payment.failed"
    })
  })

  it.each([
    ["created", "CREATED"],
    ["pending", "PENDING"],
    ["authorized", "PROCESSING"],
    ["approved", "PROCESSING"],
    ["captured", "CONFIRMED"],
    ["settled", "CONFIRMED"],
    ["successful", "CONFIRMED"],
    ["declined", "FAILED"],
    ["failed", "FAILED"],
    ["voided", "FAILED"],
    ["expired", "EXPIRED"],
    ["cancelled", "INCOMPLETE"],
    ["refunded", "REFUNDED"],
    ["mystery_state", "PENDING"],
  ] as const)("normalizes status %s to %s", async (providerStatus, expectedStatus) => {
    vi.stubEnv("SHIFT4_SECRET_KEY", "sk_test_123")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "char_shift4_123", status: providerStatus })
    }))

    await expect(getPaymentStatus("char_shift4_123")).resolves.toMatchObject({
      provider: "shift4",
      providerReference: "char_shift4_123",
      status: expectedStatus
    })
  })

  it("does not invent a checkout-session status lookup endpoint", async () => {
    const fetchSpy = vi.fn()
    vi.stubEnv("SHIFT4_SECRET_KEY", "sk_test_123")
    vi.stubGlobal("fetch", fetchSpy)

    await expect(getPaymentStatus("chse_shift4_123")).resolves.toMatchObject({
      provider: "shift4",
      providerReference: "chse_shift4_123",
      status: "PENDING"
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects unsigned webhooks in production when the webhook secret is missing", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SHIFT4_WEBHOOK_SECRET", "")

    expect(verifyWebhook({ payload: {}, rawBody: "{}", headers: {} })).toBe(false)
  })

  it("allows explicit non-production test bypass only when requested", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("SHIFT4_WEBHOOK_SECRET", "")
    vi.stubEnv("SHIFT4_WEBHOOK_TEST_BYPASS", "true")

    expect(verifyWebhook({ payload: {}, rawBody: "{}", headers: {} })).toBe(true)
  })

  it("does not bypass missing webhook secret without the explicit flag", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SHIFT4_WEBHOOK_SECRET", "")
    vi.stubEnv("SHIFT4_WEBHOOK_TEST_BYPASS", "false")

    expect(verifyWebhook({ payload: {}, rawBody: "{}", headers: {} })).toBe(false)
  })

  it("does not treat an undocumented HMAC header as verified", () => {
    const rawBody = JSON.stringify({ type: "payment.captured" })
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("SHIFT4_WEBHOOK_SECRET", "whsec_test_123")

    expect(verifyWebhook({
      payload: JSON.parse(rawBody),
      rawBody,
      headers: {
        "x-shift4-signature": "undocumented-signature"
      }
    })).toBe(false)
  })

  it("rejects invalid mocked webhook signatures", () => {
    const rawBody = JSON.stringify({ type: "payment.captured" })
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("SHIFT4_WEBHOOK_SECRET", "whsec_test_123")

    expect(verifyWebhook({
      payload: JSON.parse(rawBody),
      rawBody,
      headers: {
        "x-shift4-signature": "bad-signature"
      }
    })).toBe(false)
  })

  it("blocks createPayment before a real API call when the Shift4 secret key is missing", async () => {
    const fetchSpy = vi.fn()
    vi.stubEnv("SHIFT4_SECRET_KEY", "")
    vi.stubGlobal("fetch", fetchSpy)

    await expect(createPayment({
      paymentId: "pay_123",
      merchantAmount: 10,
      pinetreeFee: 0.15,
      grossAmount: 10.15,
      currency: "USD",
      merchantWallet: "shift4_merchant-1",
      pinetreeWallet: "",
      merchantId: "merchant-1"
    })).rejects.toThrow("Shift4 secret key not configured")

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("uses documented Basic auth for Shift4 API requests", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "char_shift4_123", status: "successful" })
    })
    vi.stubEnv("SHIFT4_SECRET_KEY", "sk_test_123")
    vi.stubGlobal("fetch", fetchSpy)

    await getPaymentStatus("char_shift4_123")

    const expected = Buffer.from("sk_test_123:").toString("base64")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.shift4.com/charges/char_shift4_123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${expected}`
        })
      })
    )
  })

  it("builds the documented checkout-session request and normalizes its response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "chse_shift4_123",
        clientSecret: "chcs_shift4_123",
        objectType: "checkoutSession",
        url: "https://pay.shift4.com/chse_shift4_123"
      })
    })
    vi.stubEnv("SHIFT4_SECRET_KEY", "sk_test_123")
    vi.stubGlobal("fetch", fetchSpy)

    await expect(createPayment({
      paymentId: "pay_123",
      merchantAmount: 10,
      pinetreeFee: 0.15,
      grossAmount: 10.15,
      currency: "usd",
      merchantWallet: "shift4_merchant-1",
      pinetreeWallet: "",
      merchantId: "merchant-1"
    })).resolves.toMatchObject({
      provider: "shift4",
      providerReference: "chse_shift4_123",
      status: "CREATED",
      amount: 10.15,
      currency: "usd",
      paymentUrl: "https://pay.shift4.com/chse_shift4_123",
      hostedUrl: "https://pay.shift4.com/chse_shift4_123",
      sessionUrl: "https://pay.shift4.com/chse_shift4_123",
      clientSecret: "chcs_shift4_123"
    })

    const [, init] = fetchSpy.mock.calls[0]
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.shift4.com/checkout-sessions")
    expect(JSON.parse(String(init.body))).toEqual({
      lineItems: [
        {
          product: {
            name: "PineTree payment pay_123",
            amount: 1015,
            currency: "USD"
          },
          quantity: 1
        }
      ],
      collectBillingAddress: true,
      collectShippingAddress: false,
      action: "payment",
      capture: true,
      metadata: {
        paymentId: "pay_123",
        merchantId: "merchant-1",
        provider: "pinetree"
      },
      vendorReference: "pay_123"
    })
  })

  it("registers Shift4 in the provider registry", async () => {
    await import("@/providers/shift4")
    const { getProviderMetadata } = await import("@/providers/registry")

    expect(getProviderMetadata("shift4")).toMatchObject({
      adapterId: "shift4",
      displayName: "Shift4",
      supportedNetworks: ["shift4"],
      capabilities: expect.objectContaining({
        hostedCheckout: true,
        webhooks: true
      })
    })
  })

  it("keeps frontend files from calling Shift4 directly", () => {
    const roots = ["components", "app"]
    const checkedFiles = roots.flatMap((root) => collectFiles(path.join(process.cwd(), root)))
      .filter((file) => !file.includes(`${path.sep}app${path.sep}api${path.sep}`))
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))

    const offenders = checkedFiles.filter((file) => {
      const source = fs.readFileSync(file, "utf8")
      return /api\.shift4\.com|SHIFT4_SECRET_KEY|SHIFT4_WEBHOOK_SECRET/.test(source)
    })

    expect(offenders).toEqual([])
  })
})

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const entries = fs.readdirSync(root, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name)
    return entry.isDirectory() ? collectFiles(fullPath) : [fullPath]
  })
}
