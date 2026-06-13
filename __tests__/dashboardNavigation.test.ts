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

  it("organizes Developer into compact control-center tabs", () => {
    const developer = read("app/dashboard/developer/page.tsx")
    const publicKeys = read("app/dashboard/developer/PublicKeysPanel.tsx")

    expect(developer).toContain("Manage API keys, webhooks, SDKs, and integrations.")
    expect(developer).toContain('{ id: "keys", label: "Keys" }')
    expect(developer).toContain('{ id: "webhooks", label: "Webhooks" }')
    expect(developer).toContain('{ id: "sdks", label: "SDKs" }')
    expect(developer).toContain('{ id: "integrations", label: "Integrations" }')
    expect(developer).toContain("<CheckoutWorkspace")
    expect(developer).toContain('mode="developer"')
    expect(developer).toContain("<PublicKeysPanel />")
    expect(developer).toContain("Getting Started")
    expect(developer).not.toContain("V1 Quick Start")
    expect(developer).not.toContain("v1 Quick Start")
    expect(developer).toContain("Node SDK")
    expect(developer).toContain("JavaScript SDK")
    expect(developer).toContain("React SDK")
    expect(developer).toContain("WooCommerce")
    expect(developer).toContain('status="Private Beta"')
    expect(developer).toContain("Shopify")
    expect(developer).toContain("Foundation")   // Shopify card changed from "Coming Soon" to "Foundation"
    expect(publicKeys).toContain("pk_live_*")
    expect(publicKeys).toContain("/api/merchant/public-keys")
  })
})
