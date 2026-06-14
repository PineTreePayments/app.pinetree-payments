import { describe, expect, it } from "vitest"
import {
  isValidShopDomain,
  buildShopifyAuthUrl,
  buildTokenExchangeBody,
  createOAuthContext,
  generateOAuthState,
  verifyOAuthContext,
} from "../lib/oauth"

// ── isValidShopDomain ─────────────────────────────────────────────────────────

describe("isValidShopDomain", () => {
  it("accepts a standard myshopify.com domain", () => {
    expect(isValidShopDomain("mystore.myshopify.com")).toBe(true)
  })

  it("accepts a domain with hyphens", () => {
    expect(isValidShopDomain("my-great-store.myshopify.com")).toBe(true)
  })

  it("rejects a domain with a path", () => {
    expect(isValidShopDomain("mystore.myshopify.com/admin")).toBe(false)
  })

  it("rejects a non-myshopify.com domain", () => {
    expect(isValidShopDomain("evil.com")).toBe(false)
  })

  it("rejects a domain with the protocol prefix", () => {
    expect(isValidShopDomain("https://mystore.myshopify.com")).toBe(false)
  })

  it("rejects an open-redirect subdomain trick", () => {
    expect(isValidShopDomain("evil.myshopify.com.attacker.com")).toBe(false)
  })

  it("rejects a leading hyphen", () => {
    expect(isValidShopDomain("-store.myshopify.com")).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(isValidShopDomain("")).toBe(false)
  })
})

// ── buildShopifyAuthUrl ───────────────────────────────────────────────────────

describe("buildShopifyAuthUrl", () => {
  const defaults = {
    shop:        "mystore.myshopify.com",
    clientId:    "test_client_id",
    redirectUri: "https://app.pinetree-payments.com/api/shopify/auth/callback",
    state:       "abc123def456",
  }

  it("builds a well-formed authorization URL", () => {
    const url = new URL(buildShopifyAuthUrl(defaults))
    expect(url.hostname).toBe("mystore.myshopify.com")
    expect(url.pathname).toBe("/admin/oauth/authorize")
  })

  it("includes client_id, redirect_uri, state, and scope params", () => {
    const url = new URL(buildShopifyAuthUrl(defaults))
    expect(url.searchParams.get("client_id")).toBe("test_client_id")
    expect(url.searchParams.get("redirect_uri")).toBe(defaults.redirectUri)
    expect(url.searchParams.get("state")).toBe("abc123def456")
    expect(url.searchParams.get("scope")).toBeTruthy()
  })

  it("uses a custom scope when provided", () => {
    const url = new URL(buildShopifyAuthUrl({ ...defaults, scopes: "read_orders" }))
    expect(url.searchParams.get("scope")).toBe("read_orders")
  })
})

// ── buildTokenExchangeBody ────────────────────────────────────────────────────

describe("buildTokenExchangeBody", () => {
  it("targets the correct token endpoint", () => {
    const { url } = buildTokenExchangeBody({
      shop: "mystore.myshopify.com",
      clientId: "cid",
      clientSecret: "csec",
      code: "authcode123",
    })
    expect(url).toBe("https://mystore.myshopify.com/admin/oauth/access_token")
  })

  it("includes all required body params", () => {
    const { body } = buildTokenExchangeBody({
      shop: "mystore.myshopify.com",
      clientId: "cid",
      clientSecret: "csec",
      code: "authcode123",
    })
    expect(body.get("client_id")).toBe("cid")
    expect(body.get("client_secret")).toBe("csec")
    expect(body.get("code")).toBe("authcode123")
  })
})

// ── generateOAuthState ────────────────────────────────────────────────────────

describe("generateOAuthState", () => {
  it("returns a non-empty lowercase hex string", () => {
    expect(generateOAuthState()).toMatch(/^[0-9a-f]+$/)
  })

  it("returns at least 16 hex chars (64-bit entropy)", () => {
    expect(generateOAuthState().length).toBeGreaterThanOrEqual(16)
  })

  it("produces unique values on each call", () => {
    const states = new Set(Array.from({ length: 20 }, generateOAuthState))
    expect(states.size).toBe(20)
  })
})

describe("merchant-bound OAuth context", () => {
  it("round-trips the state and merchant ID", () => {
    const value = createOAuthContext(
      { state: "csrf_123", merchantId: "merchant_1" },
      "shopify-secret"
    )
    expect(verifyOAuthContext(value, "shopify-secret")).toEqual({
      state: "csrf_123",
      merchantId: "merchant_1",
    })
  })

  it("rejects a modified context", () => {
    const value = createOAuthContext(
      { state: "csrf_123", merchantId: "merchant_1" },
      "shopify-secret"
    )
    expect(verifyOAuthContext(`${value}modified`, "shopify-secret")).toBeNull()
  })
})
