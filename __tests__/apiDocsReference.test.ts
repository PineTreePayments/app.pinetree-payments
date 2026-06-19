import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SUPPORTED_WEBHOOK_EVENTS } from "@/lib/webhooks/events"

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

  it("uses professional API naming without V1 branding", () => {
    const files = [
      "docs/api/index.md",
      "docs/api/overview.md",
      "docs/api/authentication.md",
      "docs/api/quickstart.md",
      "docs/api/webhooks.md",
      "docs/api/sdks.md",
      "docs/api/partner-api-summary.md",
      "packages/pinetree-node/package.json",
      "app/dashboard/developer/page.tsx",
    ]
    const copy = files.map(read).join("\n")

    expect(copy).toContain("PineTree API")
    expect(copy).toContain("/api/v1")
    expect(copy).toContain("PineTree API uses versioned REST endpoints")
    expect(copy).not.toMatch(/\bV1 API\b|\bV1 Quickstart\b|\bV1 Webhooks\b|\bV1 SDKs\b|Version One API|PineTree API V1|PineTree API v1|PineTree v1 platform API|REST API v1/i)
  })

  it("keeps webhook-events docs aligned with implemented event constants", () => {
    const copy = read("docs/api/webhook-events.md")
    const eventTable = copy.slice(
      copy.indexOf("| Event | Description | Object | Trigger |"),
      copy.indexOf("## Event envelope")
    )
    const documentedEvents = eventTable
      .split("\n")
      .map((line) => line.match(/^\| `([^`]+)` \|/)?.[1])
      .filter((event): event is string => Boolean(event))

    expect(documentedEvents).toEqual([...SUPPORTED_WEBHOOK_EVENTS])
    expect(documentedEvents).toContain("payment_link.disabled")
    expect(documentedEvents).not.toContain("payment_link.archived")
  })
})
