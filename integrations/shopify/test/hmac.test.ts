import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { verifyShopifyWebhook, verifyShopifyOAuthCallback } from "../lib/hmac"

const SECRET = "shopify_test_client_secret_abc123"
const BODY   = '{"id":1,"email":"customer@example.com","total_price":"49.99"}'

function makeWebhookHmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64")
}

function makeCallbackHmac(params: Record<string, string>, secret: string): string {
  const message = Object.entries(params)
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  return createHmac("sha256", secret).update(message).digest("hex")
}

// ── Webhook HMAC ──────────────────────────────────────────────────────────────

describe("verifyShopifyWebhook", () => {
  it("accepts a valid HMAC", () => {
    const hmac = makeWebhookHmac(BODY, SECRET)
    expect(verifyShopifyWebhook(BODY, hmac, SECRET)).toBe(true)
  })

  it("rejects a tampered body", () => {
    const hmac = makeWebhookHmac(BODY, SECRET)
    expect(verifyShopifyWebhook('{"id":2}', hmac, SECRET)).toBe(false)
  })

  it("rejects the wrong client secret", () => {
    const hmac = makeWebhookHmac(BODY, "wrong_secret")
    expect(verifyShopifyWebhook(BODY, hmac, SECRET)).toBe(false)
  })

  it("rejects an empty HMAC header", () => {
    expect(verifyShopifyWebhook(BODY, "", SECRET)).toBe(false)
  })

  it("rejects a forged all-zeros signature", () => {
    const zeros = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    expect(verifyShopifyWebhook(BODY, zeros, SECRET)).toBe(false)
  })

  it("accepts Buffer body with the same bytes", () => {
    const hmac = makeWebhookHmac(BODY, SECRET)
    expect(verifyShopifyWebhook(Buffer.from(BODY, "utf8"), hmac, SECRET)).toBe(true)
  })

  it("rejects a Buffer with different bytes even with a matching string hmac", () => {
    const hmac = makeWebhookHmac(BODY, SECRET)
    expect(verifyShopifyWebhook(Buffer.from("tampered"), hmac, SECRET)).toBe(false)
  })
})

// ── OAuth callback HMAC ───────────────────────────────────────────────────────

describe("verifyShopifyOAuthCallback", () => {
  const base = {
    code:      "0907a61c0c8d55e99db179b68161bc00",
    shop:      "some-shop.myshopify.com",
    state:     "0755bb6a5e23e5af",
    timestamp: "1337178173",
  }

  it("accepts a valid OAuth callback", () => {
    const params = { ...base, hmac: makeCallbackHmac(base, SECRET) }
    expect(verifyShopifyOAuthCallback(params, SECRET)).toBe(true)
  })

  it("rejects a tampered shop param", () => {
    const legit = makeCallbackHmac(base, SECRET)
    const params = { ...base, shop: "evil.myshopify.com", hmac: legit }
    expect(verifyShopifyOAuthCallback(params, SECRET)).toBe(false)
  })

  it("rejects a missing hmac param", () => {
    expect(verifyShopifyOAuthCallback(base, SECRET)).toBe(false)
  })

  it("rejects an empty hmac param", () => {
    expect(verifyShopifyOAuthCallback({ ...base, hmac: "" }, SECRET)).toBe(false)
  })

  it("rejects the wrong secret", () => {
    const params = { ...base, hmac: makeCallbackHmac(base, "wrong") }
    expect(verifyShopifyOAuthCallback(params, SECRET)).toBe(false)
  })

  it("is order-independent (params sorted before hashing)", () => {
    // Reverse the param order; the verify fn must sort before hashing.
    const hmac = makeCallbackHmac(base, SECRET)
    const reversed = Object.fromEntries(Object.entries({ ...base, hmac }).reverse())
    expect(verifyShopifyOAuthCallback(reversed, SECRET)).toBe(true)
  })
})
