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

  it("keeps Squarespace docs aligned with the in-app Developer Documents navigation", () => {
    const page = read("app/dashboard/developer/page.tsx")
    const squarespace = read("docs/api/squarespace-api-docs.html")
    const navBlock = page.slice(page.indexOf("const docNav"), page.indexOf("function CodeBlock"))
    const labels = [...navBlock.matchAll(/label: "([^"]+)"/g)].map((match) => match[1])

    expect(labels).toEqual([
      "Overview",
      "Quickstart",
      "Authentication",
      "API Keys",
      "Checkout Sessions",
      "Browser Checkout",
      "Payments",
      "Session Statuses",
      "Rails & Assets",
      "Payment States",
      "Webhooks",
      "Webhook Payload",
      "Webhook Events",
      "Webhook Deliveries",
      "Errors",
      "Idempotency",
      "SDKs",
      "Testing",
      "Go Live",
      "Not Yet Supported",
      "Support",
    ])

    for (const label of labels) {
      expect(squarespace).toContain(`data-doc-label="${label.replace("&", "&amp;")}"`)
    }
  })

  it("keeps Squarespace docs professional and /api/v1 endpoint-focused", () => {
    const squarespace = read("docs/api/squarespace-api-docs.html")

    expect(squarespace).toContain("PineTree API uses versioned REST endpoints. The current API path prefix is <code>/api/v1</code>.")
    expect(squarespace).toContain("POST</span><code>/api/v1/checkout/sessions</code>")
    expect(squarespace).toContain("GET</span><code>/api/v1/checkout/sessions/{id}</code>")
    expect(squarespace).toContain("POST</span><code>/api/v1/checkout/sessions/{id}/cancel</code>")
    expect(squarespace).toContain("POST</span><code>/api/v1/checkout/sessions/{id}/expire</code>")
    expect(squarespace).toContain("GET</span><code>/api/v1/payments/{id}</code>")
    expect(squarespace).toContain("GET</span><code>/api/v1/webhook-deliveries</code>")
    expect(squarespace).toContain("POST</span><code>/api/v1/webhook-deliveries/{id}/retry</code>")
    expect(squarespace).toContain("POST</span><code>/api/v1/browser/checkout/sessions</code>")
    expect(squarespace).not.toMatch(/\bV1 API\b|\bV1 Quickstart\b|\bV1 Webhooks\b|\bV1 SDKs\b|PineTree API V1|PineTree API v1|REST API v1/i)
  })

  it("keeps Squarespace docs aligned with supported events, rails, and visible states", () => {
    const squarespace = read("docs/api/squarespace-api-docs.html")

    expect(squarespace).toContain("Webhook Events")
    expect(squarespace).toContain("Rails &amp; Assets")
    expect(squarespace).toContain("Payment States")
    for (const event of SUPPORTED_WEBHOOK_EVENTS) {
      expect(squarespace).toContain(`<code>${event}</code>`)
    }
    expect(squarespace).toContain("payment_link.disabled")
    expect(squarespace).not.toContain("payment_link.archived")
    expect(squarespace).toContain("<td><strong class=\"pt-green\">Confirmed</strong></td><td>Payment confirmed</td><td>Yes</td><td>Green</td>")
    expect(squarespace).not.toMatch(/<td>\s*Success\s*<\/td>/)
    expect(squarespace).toContain("<td><code>solana</code></td><td>SOL, USDC</td>")
    expect(squarespace).toContain("<td><code>base</code></td><td>ETH, USDC</td>")
    expect(squarespace).toContain("<td><code>bitcoin_lightning</code></td><td>BTC</td>")
    expect(squarespace).toContain("<td><code>shift4</code></td><td>Card / USD</td>")
    expect(squarespace).not.toMatch(/\b(?:solana_usdc|base_usdc|base_eth|usdc_base)\b/)
  })
})

/* ══ Single API entry point ═════════════════════════════════════════════════ */

describe("API documentation has one entry point", () => {
  const INDEX = "docs/api/index.md"
  const RETIRED_OVERVIEW = "docs/api/overview.md"

  it("keeps docs/api/index.md as the entry point and no overview.md beside it", () => {
    expect(fs.existsSync(path.join(process.cwd(), INDEX))).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), RETIRED_OVERVIEW))).toBe(false)
  })

  it("has no Markdown link anywhere pointing at the retired overview", () => {
    const markdown = fs
      .readdirSync(path.join(process.cwd(), "docs"), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name.replace(/\\/g, "/")}`)

    const offenders = [...markdown, "README.md", "AGENTS.md"]
      .filter((file) => fs.existsSync(path.join(process.cwd(), file)))
      .filter((file) => /\]\([^)]*api\/overview\.md/.test(read(file)) || /\]\(\.\/overview\.md\)/.test(read(file)))

    expect(offenders).toEqual([])
  })

  it("has no task-map entry pointing at the retired overview", () => {
    const taskMap = read(".ai/task-map.json")
    expect(taskMap).not.toContain(RETIRED_OVERVIEW)
  })

  it("links to every active core API contract", () => {
    const copy = read(INDEX)
    for (const contract of [
      "authentication.md",
      "api-keys.md",
      "errors.md",
      "idempotency.md",
      "payments.md",
      "payment-states.md",
      "checkout-sessions.md",
      "webhooks.md",
      "webhook-events.md",
      "webhook-deliveries.md",
      "sdks.md",
      "openapi.yaml",
    ]) {
      expect(copy, `index must link ${contract}`).toContain(`(./${contract})`)
    }
  })

  it("distinguishes public API contracts from internal and provider-webhook routes", () => {
    const copy = read(INDEX)
    expect(copy).toContain("Public API scope")
    expect(copy).toMatch(/Public versus internal routes/i)
    expect(copy).toMatch(/Provider webhook intake/i)
    // The boundary must be stated, not merely implied by two tables. Markdown
    // wraps prose, so match across a line break.
    expect(copy.replace(/\s+/g, " ")).toMatch(/internal application API/i)
    expect(copy.replace(/\s+/g, " ")).toMatch(/must not be integrated against/i)
  })

  it("does not present the retired generic provider webhook route as active", () => {
    const copy = read(INDEX)
    if (copy.includes("/api/webhooks/provider")) {
      const line = copy.split("\n").find((l) => l.includes("/api/webhooks/provider")) ?? ""
      const context = copy.slice(Math.max(0, copy.indexOf(line) - 200), copy.indexOf(line) + line.length + 200)
      expect(context).toMatch(/retired/i)
      expect(context).toContain("410")
    }
  })

  it("carries no hard-coded route count that will go stale", () => {
    const copy = read(INDEX)
    expect(copy).not.toMatch(/\(\s*\d{2,}\s*total\s*\)/i)
    expect(copy).not.toMatch(/\b\d{2,}\s+(?:routes|endpoints)\b/i)
  })

  it("resolves every relative link in the API index", () => {
    const copy = read(INDEX)
    const broken: string[] = []
    for (const match of copy.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const raw = match[1]
      if (/^(https?:|mailto:|#)/.test(raw)) continue
      const target = raw.split("#")[0]
      if (!target) continue
      if (!fs.existsSync(path.join(process.cwd(), "docs", "api", target))) broken.push(raw)
    }
    expect(broken).toEqual([])
  })

  it("is listed as the API entry point in docs/INDEX.md, which no longer lists overview", () => {
    const index = read("docs/INDEX.md")
    expect(index).toContain("api/index.md")
    expect(index).not.toContain("api/overview.md")
  })
})
