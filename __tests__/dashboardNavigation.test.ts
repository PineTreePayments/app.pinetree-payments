import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("dashboard checkout and developer navigation", () => {
  it("adds distinct merchant and developer navigation entries", () => {
    const layout = read("app/dashboard/layout.tsx")

    expect(layout).toContain('{ name: "Online Checkout", href: "/dashboard/checkout" }')
    expect(layout).toContain('{ name: "Developer", href: "/dashboard/developer" }')
    expect(layout.indexOf('{ name: "Help Center", href: "/dashboard/help" }')).toBeLessThan(
      layout.indexOf('{ name: "Developer", href: "/dashboard/developer" }')
    )
    expect(layout.indexOf('{ name: "Developer", href: "/dashboard/developer" }')).toBeLessThan(
      layout.indexOf('{ name: "Settings", href: "/dashboard/settings" }')
    )
    expect(layout).not.toContain('description: "Create payment links')
    expect(layout).not.toContain('description: "API keys, webhooks')
  })

  it("keeps Online Checkout merchant-facing", () => {
    const checkout = read("app/dashboard/checkout/page.tsx")

    expect(checkout).toContain('"Create payment links and checkout buttons for customers."')
    expect(checkout).toContain("Create and share hosted checkout links.")
    expect(checkout).toContain("Add a checkout button to your website.")
    expect(checkout).toContain("Checkout readiness")
    expect(checkout).toContain("Getting paid online")
    expect(checkout).toContain("Payment Links & Recent Checkout Activity")
    expect(checkout).toContain("Need API keys, webhooks, or SDKs?")
    expect(checkout).toContain('href="/dashboard/developer"')
    expect(checkout).toContain('mode === "developer" && tab === "webhooks"')
    expect(checkout).toContain('mode === "developer" && tab === "developer"')
  })

  it("uses compact Developer cards as the only section selector", () => {
    const developer = read("app/dashboard/developer/page.tsx")
    const publicKeys = read("app/dashboard/developer/PublicKeysPanel.tsx")
    const shopifyCard = read("app/dashboard/developer/ShopifyIntegrationCard.tsx")
    const checkout = read("app/dashboard/checkout/page.tsx")

    expect(developer).toContain("Manage API keys, webhooks, SDKs, and integrations.")
    expect(developer).not.toContain("const tabs")
    expect(developer).not.toContain("tabs.map")
    expect(developer).toContain("aria-pressed={tab === id}")
    expect(developer).toContain("<CheckoutWorkspace")
    expect(developer).toContain('mode="developer"')
    expect(developer).toContain("<PublicKeysPanel />")
    expect(developer).toContain("Getting Started")
    expect(developer).not.toContain("V1 Quick Start")
    expect(developer).not.toContain("v1 Quick Start")
    expect(developer).toContain("Node SDK")
    expect(developer).toContain("JavaScript SDK")
    expect(developer).toContain("React SDK")
    expect(developer.match(/status: "Ready"/g)).toHaveLength(4)
    expect(developer).toContain("Use a secret API key from your server.")
    expect(developer).toContain("WooCommerce")
    expect(developer).toContain('status="Ready for install testing"')
    expect(developer).toContain("Install the private plugin in a WooCommerce test store to validate checkout and webhooks.")
    expect(shopifyCard).toContain("Connect a Shopify store to use PineTree Checkout.")
    expect(shopifyCard).toContain('"Connected" : "Not connected"')
    expect(shopifyCard).toContain("Connect Shopify")
    expect(shopifyCard).toContain("Disconnect")
    expect(shopifyCard).toContain("View setup guide")
    expect(shopifyCard).not.toContain("Requires setup")
    expect(shopifyCard).not.toContain("OAuth")
    expect(shopifyCard).not.toContain("shopify_connections")
    expect(shopifyCard).not.toContain("/api/shopify/session")
    expect(developer).not.toContain("Foundation")
    expect(developer).not.toContain("Preview")
    expect(developer).not.toContain("Private Beta")
    expect(developer).toContain("Packages are ready for release; npm publication pending.")
    expect(developer).not.toContain('label="Live"')
    expect(developer).not.toMatch(/\bV1\b|\bv1\b|version one|PineTree API v1|\/api\/v1/i)
    expect(checkout).not.toContain("Failed attempts remain retryable through the v1 delivery API.")
    expect(checkout).not.toContain("V1 events also include")
    expect(checkout).toContain("Failed deliveries can be retried safely from this dashboard.")
    expect(checkout).toContain("Use <code className=\"font-mono\">pt_live_*</code> only on your server.")
    expect(developer).toContain("Use these only on your server. They can create sessions, retrieve payments, and manage webhooks.")
    expect(developer).toContain("Use these on websites, checkout buttons, or React apps.")
    expect(publicKeys).toContain("pk_live_*")
    expect(publicKeys).toContain("cannot access private account data")
    expect(publicKeys).toContain("/api/merchant/public-keys")
  })
})
