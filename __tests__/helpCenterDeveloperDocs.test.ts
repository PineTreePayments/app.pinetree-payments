import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { helpArticles } from "@/lib/help/helpContent"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Help Center Developer documentation", () => {
  const developerArticles = helpArticles.filter((article) => article.category === "Developer/API")
  const developerCopy = developerArticles
    .map((article) => [
      article.title,
      article.description,
      article.body,
      article.tags.join(" "),
      article.keywords?.join(" ") || "",
    ].join("\n"))
    .join("\n")
  const helpPage = read("app/dashboard/help/page.tsx")
  const visibleHelpCopy = `${developerCopy}\n${helpPage}`

  it("shows the published SDK packages and REST API guidance", () => {
    expect(developerCopy).toContain("npm install @pinetreepayments/node")
    expect(developerCopy).toContain("npm install @pinetreepayments/js")
    expect(developerCopy).toContain("npm install @pinetreepayments/react")
    expect(developerCopy).toContain("REST API: No package required. Use a secret API key from your server.")
    expect(developerCopy).not.toMatch(/@pinetree\/(?:node|js|react)/)
  })

  it("documents the dashboard-first WooCommerce setup without internal references", () => {
    expect(developerCopy).toContain(
      "Open Developer → Integrations and download the PineTree WooCommerce plugin from the dashboard"
    )
    expect(developerCopy).toContain("?wc-api=pinetree_webhook")
    expect(developerCopy).toContain("Duplicate webhook events should not duplicate order notes or status changes.")
    expect(developerCopy).toContain("Manual sync")
    expect(developerCopy).not.toMatch(/github|onboarding contact|repo(?:sitory)? folder|commit history|source path/i)
  })

  it("documents the Shopify Connected and Not connected merchant flow", () => {
    expect(developerCopy).toContain("Open Developer → Integrations.")
    expect(developerCopy).toContain("Not connected")
    expect(developerCopy).toContain("Connect Shopify")
    expect(developerCopy).toContain("approve the PineTree app in Shopify")
    expect(developerCopy).toContain("Connected")
    expect(developerCopy).toContain(
      "Shopify must be enabled by PineTree deployment configuration before merchants can connect."
    )
  })

  it("keeps Help Center Developer content current and merchant-facing", () => {
    expect(helpPage).toContain('title: "Developer Tools"')
    expect(helpPage).toContain('articleIds: ["api-keys", "webhooks", "sdks", "woocommerce", "shopify"]')
    expect(visibleHelpCopy).not.toMatch(
      /publication pending|Foundation|Private Beta|Preview|backend checklist|internal checklist/i
    )
    expect(visibleHelpCopy).not.toMatch(
      /npm_[A-Za-z0-9]+|SHOPIFY_CLIENT_SECRET\s*=|SHOPIFY_TOKEN_ENCRYPTION_KEY\s*=|[A-Z]:\\|\/home\/|\/Users\//
    )
  })
})
