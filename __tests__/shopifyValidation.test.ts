import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  getMerchantConnection: vi.fn(),
  getActiveMerchantConnection: vi.fn(),
  markUninstalled: vi.fn(),
  upsertConnection: vi.fn(),
  encryptToken: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: () => 500,
}))

vi.mock("@/database/shopifyConnections", () => ({
  getMerchantShopifyConnection: mocks.getMerchantConnection,
  getActiveMerchantShopifyConnection: mocks.getActiveMerchantConnection,
  markShopifyConnectionUninstalled: mocks.markUninstalled,
  upsertShopifyConnection: mocks.upsertConnection,
}))

vi.mock("@/integrations/shopify/lib/crypto", () => ({
  encryptShopifyToken: mocks.encryptToken,
}))

import { POST as startAuth } from "@/app/api/shopify/auth/route"
import { GET as completeAuth } from "@/app/api/shopify/auth/callback/route"
import { POST as receiveWebhook } from "@/app/api/shopify/webhooks/route"
import { GET as getStatus } from "@/app/api/shopify/status/route"
import { POST as disconnect } from "@/app/api/shopify/disconnect/route"
import { createOAuthContext } from "@/integrations/shopify/lib/oauth"

const CLIENT_SECRET = "shopify-secret"

function signedOAuthParams(state: string) {
  const unsigned = { shop: "pine-store.myshopify.com", code: "fake_code", state, timestamp: "1710000000" }
  const hmac = createHmac("sha256", CLIENT_SECRET)
    .update(Object.entries(unsigned).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&"))
    .digest("hex")
  return { ...unsigned, hmac }
}

describe("Shopify auth domain validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    process.env.SHOPIFY_CLIENT_ID = "client_123"
    process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET
    process.env.SHOPIFY_SCOPES = "read_orders,write_orders"
    process.env.SHOPIFY_APP_URL = "https://app.test"
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("rejects a non-Shopify domain", async () => {
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "not-a-shopify-store.example.com" }),
    }))
    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toContain("mystore.myshopify.com")
  })

  it("rejects a subdomain attack (sub.store.myshopify.com)", async () => {
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "evil.pine-store.myshopify.com" }),
    }))
    expect(response.status).toBe(400)
  })

  it("rejects a domain with a path component", async () => {
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "pine-store.myshopify.com/admin" }),
    }))
    expect(response.status).toBe(400)
  })

  it("rejects an empty shop field", async () => {
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "" }),
    }))
    expect(response.status).toBe(400)
  })

  it("returns 503 when SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET is missing", async () => {
    delete process.env.SHOPIFY_CLIENT_ID
    delete process.env.SHOPIFY_CLIENT_SECRET
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "pine-store.myshopify.com" }),
    }))
    expect(response.status).toBe(503)
  })

  it("accepts a well-formed myshopify.com domain", async () => {
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "my-store.myshopify.com" }),
    }))
    // Proceeds past domain check (401 from auth, not 400 from domain)
    expect(response.status).not.toBe(400)
    expect(response.status).not.toBe(503)
  })
})

describe("Shopify OAuth callback protection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    mocks.encryptToken.mockReturnValue("encrypted-token")
    process.env.SHOPIFY_CLIENT_ID = "client_123"
    process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET
    process.env.SHOPIFY_SCOPES = "read_orders,write_orders"
    process.env.SHOPIFY_APP_URL = "https://app.test"
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("rejects callback when URL state does not match cookie state", async () => {
    const context = createOAuthContext({ state: "correct-state", merchantId: "merchant_1" }, CLIENT_SECRET)
    // URL carries a different state — even with a valid HMAC over that state
    const params = signedOAuthParams("wrong-state")
    const response = await completeAuth(new NextRequest(
      `https://app.test/api/shopify/auth/callback?${new URLSearchParams(params)}`,
      { headers: { cookie: `shopify_oauth_context=${context}` } }
    ))
    expect(response.status).toBe(401)
  })

  it("rejects callback when OAuth HMAC is tampered", async () => {
    const state = "csrf_123"
    const context = createOAuthContext({ state, merchantId: "merchant_1" }, CLIENT_SECRET)
    const params = {
      shop: "pine-store.myshopify.com",
      code: "fake_code",
      state,
      timestamp: "1710000000",
      hmac: "deadbeef0000000000000000000000000000000000000000000000000000000000", // wrong
    }
    const response = await completeAuth(new NextRequest(
      `https://app.test/api/shopify/auth/callback?${new URLSearchParams(params)}`,
      { headers: { cookie: `shopify_oauth_context=${context}` } }
    ))
    expect(response.status).toBe(401)
  })

  it("rejects callback when no OAuth cookie is present", async () => {
    const params = signedOAuthParams("csrf_123")
    const response = await completeAuth(new NextRequest(
      `https://app.test/api/shopify/auth/callback?${new URLSearchParams(params)}`
    ))
    expect(response.status).toBe(401)
  })

  it("rejects callback when config is missing", async () => {
    delete process.env.SHOPIFY_CLIENT_SECRET
    const params = signedOAuthParams("csrf_123")
    const response = await completeAuth(new NextRequest(
      `https://app.test/api/shopify/auth/callback?${new URLSearchParams(params)}`
    ))
    expect(response.status).toBe(503)
  })
})

describe("Shopify webhook HMAC protection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET
  })

  it("returns 401 for an invalid webhook HMAC", async () => {
    const body = JSON.stringify({ id: 42 })
    const response = await receiveWebhook(new NextRequest("https://app.test/api/shopify/webhooks", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": "bm90LXZhbGlk", // base64("not-valid")
        "x-shopify-topic": "orders/paid",
        "x-shopify-shop-domain": "pine-store.myshopify.com",
      },
      body,
    }))
    expect(response.status).toBe(401)
    expect(mocks.markUninstalled).not.toHaveBeenCalled()
  })

  it("acknowledges an unknown webhook topic without crashing (200)", async () => {
    const body = JSON.stringify({ id: 99 })
    const hmac = createHmac("sha256", CLIENT_SECRET).update(body).digest("base64")
    const response = await receiveWebhook(new NextRequest("https://app.test/api/shopify/webhooks", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-topic": "products/create",
        "x-shopify-shop-domain": "pine-store.myshopify.com",
      },
      body,
    }))
    expect(response.status).toBe(200)
  })

  it("returns 503 when SHOPIFY_CLIENT_SECRET is missing", async () => {
    delete process.env.SHOPIFY_CLIENT_SECRET
    const response = await receiveWebhook(new NextRequest("https://app.test/api/shopify/webhooks", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": "any",
        "x-shopify-topic": "orders/paid",
        "x-shopify-shop-domain": "pine-store.myshopify.com",
      },
      body: "{}",
    }))
    expect(response.status).toBe(503)
  })
})

describe("Shopify status route validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    mocks.getActiveMerchantConnection.mockResolvedValue(null)
    process.env.SHOPIFY_CLIENT_ID = "client_123"
    process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET
    process.env.SHOPIFY_SCOPES = "read_orders,write_orders"
    process.env.SHOPIFY_APP_URL = "https://app.test"
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("returns 400 when shop query param is not a valid myshopify.com domain", async () => {
    const response = await getStatus(new NextRequest(
      "https://app.test/api/shopify/status?shop=not-valid-domain",
      { headers: { Authorization: "Bearer token" } }
    ))
    expect(response.status).toBe(400)
  })

  it("returns not-connected when no shop param is given and no connection exists", async () => {
    const response = await getStatus(new NextRequest(
      "https://app.test/api/shopify/status",
      { headers: { Authorization: "Bearer token" } }
    ))
    const body = await response.json() as { connected: boolean; configured: boolean }
    expect(response.status).toBe(200)
    expect(body.connected).toBe(false)
    expect(body.configured).toBe(true)
  })
})

describe("Shopify disconnect route validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    process.env.SHOPIFY_CLIENT_ID = "client_123"
    process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET
    process.env.SHOPIFY_APP_URL = "https://app.test"
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("returns 400 when shop domain is not a myshopify.com address", async () => {
    const response = await disconnect(new NextRequest("https://app.test/api/shopify/disconnect", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "not-shopify.example.com" }),
    }))
    expect(response.status).toBe(400)
  })

  it("returns 400 when shop field is missing", async () => {
    const response = await disconnect(new NextRequest("https://app.test/api/shopify/disconnect", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }))
    expect(response.status).toBe(400)
  })

  it("returns 404 when no active connection exists for the shop", async () => {
    mocks.markUninstalled.mockResolvedValue(null)
    const response = await disconnect(new NextRequest("https://app.test/api/shopify/disconnect", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "pine-store.myshopify.com" }),
    }))
    expect(response.status).toBe(404)
  })
})
