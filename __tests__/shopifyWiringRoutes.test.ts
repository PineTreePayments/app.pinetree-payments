import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  getMerchantConnection: vi.fn(),
  getActiveMerchantConnection: vi.fn(),
  getActiveConnection: vi.fn(),
  markUninstalled: vi.fn(),
  upsertConnection: vi.fn(),
  encryptToken: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: () => 500,
}))

vi.mock("@/database/shopifyConnections", () => ({
  getMerchantShopifyConnection: mocks.getMerchantConnection,
  getActiveMerchantShopifyConnection: mocks.getActiveMerchantConnection,
  getActiveShopifyConnection: mocks.getActiveConnection,
  markShopifyConnectionUninstalled: mocks.markUninstalled,
  upsertShopifyConnection: mocks.upsertConnection,
}))

vi.mock("@/integrations/shopify/lib/crypto", () => ({
  encryptShopifyToken: mocks.encryptToken,
}))

vi.mock("@/engine/checkoutSessions", () => ({
  createCheckoutSessionEngine: mocks.createSession,
}))

import { GET as getStatus } from "@/app/api/shopify/status/route"
import { POST as disconnect } from "@/app/api/shopify/disconnect/route"
import { POST as createSession } from "@/app/api/shopify/session/route"
import { POST as receiveWebhook } from "@/app/api/shopify/webhooks/route"
import { POST as startAuth } from "@/app/api/shopify/auth/route"
import { GET as completeAuth } from "@/app/api/shopify/auth/callback/route"
import { createOAuthContext } from "@/integrations/shopify/lib/oauth"

describe("Shopify database-backed route wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
    mocks.encryptToken.mockReturnValue("encrypted-token")
    process.env.SHOPIFY_CLIENT_ID = "client_123"
    process.env.SHOPIFY_CLIENT_SECRET = "shopify-secret"
    process.env.SHOPIFY_SCOPES = "read_orders,write_orders"
    process.env.SHOPIFY_APP_URL = "https://app.test"
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = "a".repeat(64)
  })

  it("returns the merchant-scoped connection status", async () => {
    mocks.getMerchantConnection.mockResolvedValue({
      shop: "pine-store.myshopify.com",
      status: "active",
      installed_at: "2026-06-13T12:00:00.000Z",
      updated_at: "2026-06-13T12:05:00.000Z",
    })
    const response = await getStatus(new NextRequest(
      "https://app.test/api/shopify/status?shop=pine-store.myshopify.com",
      { headers: { Authorization: "Bearer dashboard-token" } }
    ))
    await expect(response.json()).resolves.toEqual({
      shop: "pine-store.myshopify.com",
      connected: true,
      status: "connected",
      connectedAt: "2026-06-13T12:00:00.000Z",
      updatedAt: "2026-06-13T12:05:00.000Z",
      configured: true,
    })
    expect(mocks.getMerchantConnection).toHaveBeenCalledWith(
      "pine-store.myshopify.com",
      "merchant_1"
    )
  })

  it("returns not connected when the merchant has no active store", async () => {
    mocks.getActiveMerchantConnection.mockResolvedValue(null)
    const response = await getStatus(new NextRequest(
      "https://app.test/api/shopify/status",
      { headers: { Authorization: "Bearer dashboard-token" } }
    ))
    await expect(response.json()).resolves.toEqual({
      connected: false,
      status: "not_connected",
      shop: null,
      connectedAt: null,
      updatedAt: null,
      configured: true,
    })
    expect(mocks.getActiveMerchantConnection).toHaveBeenCalledWith("merchant_1")
  })

  it("reports a safe unavailable state when Shopify configuration is missing", async () => {
    delete process.env.SHOPIFY_CLIENT_ID
    delete process.env.SHOPIFY_CLIENT_SECRET
    delete process.env.SHOPIFY_SCOPES
    delete process.env.SHOPIFY_APP_URL
    delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY
    mocks.getActiveMerchantConnection.mockResolvedValue(null)

    const response = await getStatus(new NextRequest(
      "https://app.test/api/shopify/status",
      { headers: { Authorization: "Bearer dashboard-token" } }
    ))

    await expect(response.json()).resolves.toEqual({
      connected: false,
      status: "not_connected",
      shop: null,
      connectedAt: null,
      updatedAt: null,
      configured: false,
    })
  })

  it("starts a merchant-bound Shopify connection", async () => {
    const response = await startAuth(new NextRequest("https://app.test/api/shopify/auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer dashboard-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ shop: "pine-store.myshopify.com" }),
    }))
    const payload = await response.json() as { authUrl: string }
    expect(new URL(payload.authUrl).hostname).toBe("pine-store.myshopify.com")
    expect(response.headers.get("set-cookie")).toContain("shopify_oauth_context=")
  })

  it("returns a safe callback error when merchant context is missing", async () => {
    const query = signedOAuthQuery("csrf_123")
    const response = await completeAuth(new NextRequest(
      `https://app.test/api/shopify/auth/callback?${new URLSearchParams(query)}`
    ))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "This Shopify connection could not be linked to your PineTree account. Start the connection again from Developer.",
    })
  })

  it("encrypts and persists a completed Shopify connection", async () => {
    const state = "csrf_123"
    const query = signedOAuthQuery(state)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "shpat_test",
      scope: "read_orders",
    }), { status: 200 })))
    const context = createOAuthContext({ state, merchantId: "merchant_1" }, "shopify-secret")
    const response = await completeAuth(new NextRequest(
      `https://app.test/api/shopify/auth/callback?${new URLSearchParams(query)}`,
      { headers: { cookie: `shopify_oauth_context=${context}` } }
    ))
    expect(response.status).toBe(307)
    expect(mocks.encryptToken).toHaveBeenCalledWith("shpat_test")
    expect(mocks.upsertConnection).toHaveBeenCalledWith({
      shop: "pine-store.myshopify.com",
      merchantId: "merchant_1",
      encryptedToken: "encrypted-token",
      scopes: "read_orders",
    })
    vi.unstubAllGlobals()
  })

  it("creates checkout internally for the connected merchant", async () => {
    mocks.getActiveConnection.mockResolvedValue({ merchant_id: "merchant_1", status: "active" })
    mocks.createSession.mockResolvedValue({
      sessionId: "cs_shopify_1",
      checkoutUrl: "https://app.test/checkout/shopify-1",
    })
    const response = await createSession(new NextRequest("https://app.test/api/shopify/session", {
      method: "POST",
      body: JSON.stringify({
        shop: "pine-store.myshopify.com",
        orderId: "gid://shopify/Order/42",
        orderNumber: "#1042",
        totalPrice: "49.99",
        currency: "USD",
        email: "buyer@example.com",
        successUrl: "https://store.test/success",
        cancelUrl: "https://store.test/cancel",
      }),
    }))
    await expect(response.json()).resolves.toEqual({
      sessionId: "cs_shopify_1",
      checkoutUrl: "https://app.test/checkout/shopify-1",
    })
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: "merchant_1",
      amount: 49.99,
      orderId: "#1042",
    }))
  })

  it("disconnects only the authenticated merchant connection", async () => {
    mocks.markUninstalled.mockResolvedValue(true)
    const response = await disconnect(new NextRequest("https://app.test/api/shopify/disconnect", {
      method: "POST",
      headers: { Authorization: "Bearer dashboard-token" },
      body: JSON.stringify({ shop: "pine-store.myshopify.com" }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.markUninstalled).toHaveBeenCalledWith(
      "pine-store.myshopify.com",
      "merchant_1"
    )
  })

  it("marks a connection uninstalled after a valid Shopify webhook", async () => {
    process.env.SHOPIFY_CLIENT_SECRET = "shopify-secret"
    const body = JSON.stringify({ id: 42 })
    const hmac = createHmac("sha256", "shopify-secret").update(body).digest("base64")
    const response = await receiveWebhook(new NextRequest("https://app.test/api/shopify/webhooks", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-topic": "app/uninstalled",
        "x-shopify-shop-domain": "pine-store.myshopify.com",
      },
      body,
    }))
    expect(response.status).toBe(200)
    expect(mocks.markUninstalled).toHaveBeenCalledWith("pine-store.myshopify.com")
  })
})

function signedOAuthQuery(state: string) {
  const unsigned = {
    shop: "pine-store.myshopify.com",
    code: "fake_code",
    state,
    timestamp: "1710000000",
  }
  const hmac = createHmac("sha256", "shopify-secret")
    .update(
      Object.entries(unsigned)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("&")
    )
    .digest("hex")
  return { ...unsigned, hmac }
}
