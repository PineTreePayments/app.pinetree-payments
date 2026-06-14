import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("staging environment readiness", () => {
  it("registers secret-safe environment commands", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>
    }
    const checker = read("scripts/check-environment.mjs")

    expect(packageJson.scripts["check:env"]).toBe("node scripts/check-environment.mjs")
    expect(packageJson.scripts["check:env:strict"]).toContain("--strict")
    expect(packageJson.scripts["smoke:staging-routes"]).toBe("node scripts/smoke-staging-routes.mjs")
    expect(checker).toContain("Values are never printed.")
    expect(checker).not.toContain("console.log(value)")
    expect(checker).toContain("must be 64 hexadecimal characters")
  })

  it("documents the required staging migrations", () => {
    const staging = read("docs/environment/staging-setup.md")
    const migrations = [
      "database/migrations/20260612_create_api_idempotency_claims.sql",
      "database/migrations/20260612_add_webhook_delivery_retry_metadata.sql",
      "database/migrations/20260613_create_merchant_public_keys.sql",
      "database/migrations/20260613_create_shopify_connections.sql",
    ]

    for (const migration of migrations) {
      expect(fs.existsSync(path.join(process.cwd(), migration))).toBe(true)
      expect(staging).toContain(migration)
    }
  })

  it("keeps Shopify secrets out of the client component", () => {
    const card = read("app/dashboard/developer/ShopifyIntegrationCard.tsx")
    expect(card).not.toContain("SHOPIFY_CLIENT_SECRET")
    expect(card).not.toContain("SHOPIFY_TOKEN_ENCRYPTION_KEY")
    expect(card).not.toContain("shopifyAccessToken")
    expect(card).not.toContain("shpat_")
  })
})
