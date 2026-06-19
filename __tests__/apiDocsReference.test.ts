import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("API reference documentation", () => {
  it("includes the implemented webhook event catalog", () => {
    const copy = read("docs/api/webhook-events.md")

    expect(copy).toContain("payment.confirmed")
    expect(copy).toContain("payment.failed")
    expect(copy).toContain("payment.expired")
    expect(copy).toContain("payment.incomplete")
    expect(copy).toContain("payment_link.disabled")
    expect(copy).not.toContain("payment_link.archived |")
  })

  it("uses Confirmed rather than Success for visible payment state docs", () => {
    const copy = read("docs/api/payment-states.md")

    expect(copy).toContain("Confirmed")
    expect(copy).not.toMatch(/\|\s*Success\s*\|/)
  })

  it("documents supported assets without invalid rail examples as valid rails", () => {
    const copy = read("docs/api/rails-and-assets.md")

    expect(copy).toContain("USDC on Solana")
    expect(copy).toContain("`solana`")
    expect(copy).toContain("Invalid rail examples")
    expect(copy).not.toMatch(/\|\s*`(?:sol|base-usdc|solana_usdc|base_usdc|base_eth)`\s*\|\s*Description/)
  })

  it("keeps the developer Documents panel organized around webhook events", () => {
    const page = read("app/dashboard/developer/page.tsx")

    expect(page).toContain('DashboardSection title="Documents"')
    expect(page).toContain("Webhook Events")
    expect(page).toContain("Rails & Assets")
    expect(page).toContain("Payment States")
  })

  it("keeps OpenAPI rails enum free of stale token-specific rail values", () => {
    const openapi = read("docs/api/openapi.yaml")

    expect(openapi).toContain("enum: [solana, base, bitcoin_lightning, lightning, shift4]")
    expect(openapi).not.toMatch(/\b(?:sol|base-usdc|solana_usdc|base_usdc|base_eth)\b/)
  })
})
