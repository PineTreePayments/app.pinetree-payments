import { describe, expect, it } from "vitest"
import {
  buildPineTreeSessionParams,
  validateShopifyOrderContext,
  type ShopifyOrderContext,
} from "../lib/checkout"

const validCtx: ShopifyOrderContext = {
  shop:        "mystore.myshopify.com",
  orderId:     "gid://shopify/Order/123456",
  orderNumber: "1042",
  totalPrice:  "49.99",
  currency:    "USD",
  email:       "customer@example.com",
  successUrl:  "https://mystore.myshopify.com/thank-you",
  cancelUrl:   "https://mystore.myshopify.com/cart",
}

// ── buildPineTreeSessionParams ────────────────────────────────────────────────

describe("buildPineTreeSessionParams", () => {
  it("maps all fields correctly", () => {
    const p = buildPineTreeSessionParams(validCtx)
    expect(p.amount).toBe(49.99)
    expect(p.currency).toBe("USD")
    expect(p.reference).toBe("1042")
    expect(p.customer?.email).toBe("customer@example.com")
    expect(p.metadata.shopify_order_id).toBe("gid://shopify/Order/123456")
    expect(p.metadata.shop).toBe("mystore.myshopify.com")
    expect(p.successUrl).toBe("https://mystore.myshopify.com/thank-you")
    expect(p.cancelUrl).toBe("https://mystore.myshopify.com/cart")
  })

  it("omits customer when email is null", () => {
    const p = buildPineTreeSessionParams({ ...validCtx, email: null })
    expect(p.customer).toBeUndefined()
  })

  it("throws on a non-numeric price string", () => {
    expect(() => buildPineTreeSessionParams({ ...validCtx, totalPrice: "not_a_number" })).toThrow()
  })

  it("throws on zero price", () => {
    expect(() => buildPineTreeSessionParams({ ...validCtx, totalPrice: "0" })).toThrow()
  })

  it("throws on a negative price", () => {
    expect(() => buildPineTreeSessionParams({ ...validCtx, totalPrice: "-5.00" })).toThrow()
  })

  it("throws on empty price string", () => {
    expect(() => buildPineTreeSessionParams({ ...validCtx, totalPrice: "" })).toThrow()
  })

  it("parses a price with more than 2 decimal places", () => {
    const p = buildPineTreeSessionParams({ ...validCtx, totalPrice: "9.999" })
    expect(p.amount).toBeCloseTo(9.999)
  })
})

// ── validateShopifyOrderContext ───────────────────────────────────────────────

describe("validateShopifyOrderContext", () => {
  it("passes for a valid context", () => {
    expect(validateShopifyOrderContext(validCtx)).toBe(true)
  })

  it("passes when email is null", () => {
    expect(validateShopifyOrderContext({ ...validCtx, email: null })).toBe(true)
  })

  it("fails when shop is empty", () => {
    expect(validateShopifyOrderContext({ ...validCtx, shop: "" })).toBe(false)
  })

  it("fails when orderId is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { orderId: _, ...rest } = validCtx
    expect(validateShopifyOrderContext(rest)).toBe(false)
  })

  it("fails when currency is not exactly 3 chars", () => {
    expect(validateShopifyOrderContext({ ...validCtx, currency: "US" })).toBe(false)
    expect(validateShopifyOrderContext({ ...validCtx, currency: "USDD" })).toBe(false)
  })

  it("fails when successUrl is http (not https)", () => {
    expect(validateShopifyOrderContext({ ...validCtx, successUrl: "http://mystore.com/ok" })).toBe(false)
  })

  it("fails when cancelUrl is http (not https)", () => {
    expect(validateShopifyOrderContext({ ...validCtx, cancelUrl: "http://mystore.com/cart" })).toBe(false)
  })

  it("fails when totalPrice is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { totalPrice: _, ...rest } = validCtx
    expect(validateShopifyOrderContext(rest)).toBe(false)
  })
})
