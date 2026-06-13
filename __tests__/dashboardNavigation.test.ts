import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("dashboard checkout and developer navigation", () => {
  it("adds distinct merchant and developer navigation entries", () => {
    const layout = read("app/dashboard/layout.tsx")

    expect(layout).toContain('name: "Online Checkout"')
    expect(layout).toContain('href: "/dashboard/checkout"')
    expect(layout).toContain("Create payment links and checkout buttons for customers.")
    expect(layout).toContain('name: "Developer"')
    expect(layout).toContain('href: "/dashboard/developer"')
    expect(layout).toContain("API keys, webhooks, SDKs, and integrations.")
  })

  it("keeps Online Checkout merchant-facing", () => {
    const checkout = read("app/dashboard/checkout/page.tsx")

    expect(checkout).toContain('"Create hosted payment links and customer checkout buttons."')
    expect(checkout).toContain('{ id: "links", label: "Payment Links" }')
    expect(checkout).toContain('{ id: "integration", label: "Checkout Buttons" }')
    expect(checkout).toContain("Need API keys or webhooks?")
    expect(checkout).toContain('href="/dashboard/developer"')
    expect(checkout).toContain('mode === "developer" && tab === "webhooks"')
    expect(checkout).toContain('mode === "developer" && tab === "developer"')
  })

  it("places technical controls and documentation on Developer", () => {
    const developer = read("app/dashboard/developer/page.tsx")
    const publicKeys = read("app/dashboard/developer/PublicKeysPanel.tsx")

    expect(developer).toContain("Manage API keys, webhooks, SDKs, and platform integrations.")
    expect(developer).toContain('<CheckoutWorkspace mode="developer"')
    expect(developer).toContain("<PublicKeysPanel />")
    expect(developer).toContain("Node SDK")
    expect(developer).toContain("JavaScript SDK")
    expect(developer).toContain("React SDK")
    expect(developer).toContain("WooCommerce")
    expect(developer).toContain("Shopify")
    expect(publicKeys).toContain("pk_live_*")
    expect(publicKeys).toContain("/api/merchant/public-keys")
  })
})
