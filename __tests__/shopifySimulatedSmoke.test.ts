import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  completeShopifyOAuth,
  createShopifyAuthRequest,
  createShopifyCheckoutSession,
  disconnectShopify,
  lookupShopifyStatus,
  processShopifyWebhook,
  type ShopifyConnection,
  type ShopifyIntegrationDeps,
} from "@/integrations/shopify/lib/handlers"

function oauthHmac(query: Record<string, string>, secret: string) {
  return createHmac("sha256", secret)
    .update(
      Object.entries(query)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("&")
    )
    .digest("hex")
}

function webhookHmac(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64")
}

function createDeps() {
  const connections = new Map<string, ShopifyConnection>()
  const deps: ShopifyIntegrationDeps = {
    exchangeToken: vi.fn(async () => ({ accessToken: "shpat_fake", scopes: "read_orders" })),
    encryptToken: vi.fn((token) => `encrypted:${token}`),
    persistConnection: vi.fn(async (connection) => {
      connections.set(connection.shop, connection)
    }),
    getConnection: vi.fn(async (shop) => connections.get(shop) ?? null),
    createCheckoutSession: vi.fn(async () => ({
      sessionId: "cs_shopify_1",
      checkoutUrl: "https://app.test/checkout/shopify-1",
    })),
    markOrderPaid: vi.fn(async () => undefined),
    markOrderCancelled: vi.fn(async () => undefined),
    markUninstalled: vi.fn(async (shop) => {
      const connection = connections.get(shop)
      if (connection) connections.set(shop, { ...connection, status: "uninstalled" })
    }),
    disconnect: vi.fn(async (shop) => connections.delete(shop)),
  }
  return { deps, connections }
}

describe("Shopify simulated integration smoke", () => {
  it("generates an OAuth URL carrying CSRF state", () => {
    const result = createShopifyAuthRequest({
      shop: "pine-store.myshopify.com",
      clientId: "client_123",
      redirectUri: "https://app.test/api/shopify/auth/callback",
      state: "csrf_123",
    })
    const url = new URL(result.authUrl)
    expect(url.hostname).toBe("pine-store.myshopify.com")
    expect(url.searchParams.get("state")).toBe("csrf_123")
    expect(url.searchParams.get("client_id")).toBe("client_123")
  })

  it("accepts a valid callback, encrypts the token, and persists the connection", async () => {
    const { deps, connections } = createDeps()
    const unsigned = {
      shop: "pine-store.myshopify.com",
      code: "fake_code",
      state: "csrf_123",
      timestamp: "1710000000",
    }
    const query = { ...unsigned, hmac: oauthHmac(unsigned, "secret_123") }
    const result = await completeShopifyOAuth(
      {
        query,
        stateCookie: "csrf_123",
        clientId: "client_123",
        clientSecret: "secret_123",
        merchantId: "merchant_1",
      },
      deps
    )
    expect(result.status).toBe("active")
    expect(deps.encryptToken).toHaveBeenCalledWith("shpat_fake")
    expect(connections.get("pine-store.myshopify.com")).toMatchObject({
      merchantId: "merchant_1",
      encryptedToken: "encrypted:shpat_fake",
      status: "active",
    })
  })

  it("looks up connection status and creates a checkout URL from fake order data", async () => {
    const { deps, connections } = createDeps()
    connections.set("pine-store.myshopify.com", {
      shop: "pine-store.myshopify.com",
      status: "active",
      merchantId: "merchant_1",
    })
    await expect(lookupShopifyStatus("pine-store.myshopify.com", deps)).resolves.toEqual({
      shop: "pine-store.myshopify.com",
      connected: true,
      status: "active",
    })
    const session = await createShopifyCheckoutSession({
      shop: "pine-store.myshopify.com",
      orderId: "gid://shopify/Order/42",
      orderNumber: "#1042",
      totalPrice: "49.99",
      currency: "USD",
      email: "buyer@example.com",
      successUrl: "https://store.test/success",
      cancelUrl: "https://store.test/cancel",
    }, deps)
    expect(session.checkoutUrl).toBe("https://app.test/checkout/shopify-1")
    expect(deps.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "shopify-gid://shopify/Order/42",
      params: expect.objectContaining({ amount: 49.99, reference: "#1042" }),
    }))
  })

  it.each([
    ["orders/paid", "markOrderPaid"],
    ["orders/cancelled", "markOrderCancelled"],
    ["app/uninstalled", "markUninstalled"],
  ] as const)("handles %s with a valid signature", async (topic, method) => {
    const { deps } = createDeps()
    const body = JSON.stringify({ id: 42, name: "#1042" })
    await processShopifyWebhook({
      rawBody: body,
      hmac: webhookHmac(body, "secret_123"),
      topic,
      shop: "pine-store.myshopify.com",
      clientSecret: "secret_123",
    }, deps)
    expect(deps[method]).toHaveBeenCalled()
  })

  it("disconnects safely through the injected persistence path", async () => {
    const { deps, connections } = createDeps()
    connections.set("pine-store.myshopify.com", {
      shop: "pine-store.myshopify.com",
      status: "active",
    })
    await expect(disconnectShopify("pine-store.myshopify.com", deps)).resolves.toEqual({
      shop: "pine-store.myshopify.com",
      disconnected: true,
    })
    expect(connections.has("pine-store.myshopify.com")).toBe(false)
  })
})
