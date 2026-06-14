import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  ShopifyIntegrationCardView,
  type ShopifyStatus,
} from "@/app/dashboard/developer/ShopifyIntegrationCardView"

const idleHandlers = {
  onShopChange: vi.fn(),
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
}

function render(status: ShopifyStatus | null, shop = "") {
  return renderToStaticMarkup(
    createElement(ShopifyIntegrationCardView, {
      status,
      shop,
      loading: false,
      working: false,
      error: "",
      ...idleHandlers,
    })
  )
}

describe("Shopify integration hub card", () => {
  it("shows the merchant connection flow when no store is connected", () => {
    const markup = render({
      connected: false,
      status: "not_connected",
      shop: null,
      connectedAt: null,
      updatedAt: null,
      configured: true,
    })

    expect(markup).toContain("Not connected")
    expect(markup).toContain("Store domain")
    expect(markup).toContain("mystore.myshopify.com")
    expect(markup).toContain("Connect Shopify")
    expect(markup).toContain("View setup guide")
    expect(markup).not.toContain("Connection unavailable")
  })

  it("disables connection controls cleanly when Shopify is unavailable", () => {
    const markup = render({
      connected: false,
      status: "not_connected",
      shop: null,
      connectedAt: null,
      updatedAt: null,
      configured: false,
    }, "pine-store.myshopify.com")

    expect(markup).toContain("Connection unavailable")
    expect(markup).toContain(
      "Shopify connection is not available yet. Contact PineTree support to enable Shopify."
    )
    expect(markup.match(/disabled=""/g)).toHaveLength(2)
    expect(markup).not.toContain("amber")
  })

  it("shows the connected store, connected time, and disconnect action", () => {
    const markup = render({
      connected: true,
      status: "connected",
      shop: "pine-store.myshopify.com",
      connectedAt: "2026-06-13T12:00:00.000Z",
      updatedAt: "2026-06-13T12:05:00.000Z",
      configured: true,
    })

    expect(markup).toContain("Connected")
    expect(markup).toContain("Connected store")
    expect(markup).toContain("pine-store.myshopify.com")
    expect(markup).toContain("Disconnect")
    expect(markup).not.toMatch(/<button[^>]*>Connect Shopify<\/button>/)
  })

  it("keeps the setup guide merchant-facing and free of internal details", () => {
    const markup = render({
      connected: false,
      status: "not_connected",
      shop: null,
      connectedAt: null,
      updatedAt: null,
      configured: true,
    })

    for (const step of [
      "Enter your Shopify store domain.",
      "Click Connect Shopify.",
      "Approve the PineTree app in Shopify.",
      "Return to PineTree.",
      "Confirm the store shows Connected.",
      "Create a test checkout once Shopify is enabled.",
      "Confirm checkout opens PineTree Checkout.",
      "Confirm order and webhook activity appears correctly.",
    ]) {
      expect(markup).toContain(step)
    }
    expect(markup).toContain(
      "Shopify setup requires PineTree app credentials to be enabled in the deployment environment."
    )
    expect(markup).not.toMatch(
      /OAuth|HMAC|token encryption|shopify_connections|backend checklist|implementation checklist|github\.com|npm_[A-Za-z0-9]+/i
    )
  })
})
