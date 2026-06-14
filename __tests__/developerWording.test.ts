import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("developer and integration wording", () => {
  it("keeps readiness labels out of merchant-facing Shopify surfaces", () => {
    const card = read("app/dashboard/developer/ShopifyIntegrationCard.tsx")
    const readme = read("integrations/shopify/README.md")
    const setup = read("integrations/shopify/SETUP.md")
    const combined = `${card}\n${readme}\n${setup}`

    expect(combined).not.toMatch(/Foundation|Private Beta|Requires setup|backend checklist|implementation checklist/i)
    expect(card).toContain('"Connected" : "Not connected"')
    expect(card).toContain("Connect Shopify")
    expect(card).toContain("View setup guide")
  })

  it("marks SDK documentation ready without version branding", () => {
    const files = [
      "docs/api/browser-sdk.md",
      "docs/api/react-sdk.md",
      "packages/pinetree-node/README.md",
      "packages/pinetree-js/README.md",
      "packages/pinetree-react/README.md",
    ]
    const copy = files.map(read).join("\n")

    expect(copy).toContain("Ready for release")
    expect(copy).not.toMatch(/Foundation|Private Beta|Requires setup/i)
    expect(copy).not.toMatch(/\bV1\b|version one|PineTree API v1/)
  })
})
