import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  getMerchantConnection: vi.fn(),
  getActiveConnection: vi.fn(),
  markUninstalled: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: () => 500,
}))

vi.mock("@/database/shopifyConnections", () => ({
  getMerchantShopifyConnection: mocks.getMerchantConnection,
  getActiveShopifyConnection: mocks.getActiveConnection,
  markShopifyConnectionUninstalled: mocks.markUninstalled,
}))

vi.mock("@/engine/checkoutSessions", () => ({
  createCheckoutSessionEngine: mocks.createSession,
}))

import { GET as getStatus } from "@/app/api/shopify/status/route"
import { POST as disconnect } from "@/app/api/shopify/disconnect/route"
import { POST as createSession } from "@/app/api/shopify/session/route"
import { POST as receiveWebhook } from "@/app/api/shopify/webhooks/route"

describe("Shopify database-backed route wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant_1")
  })

  it("returns the merchant-scoped connection status", async () => {
    mocks.getMerchantConnection.mockResolvedValue({ status: "active" })
    const response = await getStatus(new NextRequest(
      "https://app.test/api/shopify/status?shop=pine-store.myshopify.com",
      { headers: { Authorization: "Bearer dashboard-token" } }
    ))
    await expect(response.json()).resolves.toEqual({
      shop: "pine-store.myshopify.com",
      connected: true,
      status: "active",
    })
    expect(mocks.getMerchantConnection).toHaveBeenCalledWith(
      "pine-store.myshopify.com",
      "merchant_1"
    )
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
