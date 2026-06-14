import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("WooCommerce plugin download route", () => {
  it("requires merchant authentication", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).toContain("requireMerchantIdFromRequest")
  })

  it("sets correct content type and content disposition", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).toContain("application/zip")
    expect(route).toContain("pinetree-woocommerce.zip")
    expect(route).toContain("attachment")
    expect(route).toContain("Content-Disposition")
  })

  it("uses a private cache policy for the authenticated download", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).toContain("Cache-Control")
    expect(route).toContain("private")
    expect(route).toContain("no-store")
  })

  it("fails safely with 503 when artifact is missing", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).toContain("503")
    expect(route).toContain("existsSync")
    expect(route).toContain("not yet available")
  })

  it("does not expose GitHub links or plugin source paths", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).not.toContain("github.com")
    expect(route).not.toContain("plugins/woocommerce-pinetree")
  })

  it("serves from the artifacts directory", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).toContain("artifacts")
    expect(route).toContain("woocommerce")
  })
})

describe("WooCommerce card", () => {
  it("has download button wired to the plugin download route", () => {
    const card = read("app/dashboard/developer/WooCommerceIntegrationCard.tsx")
    expect(card).toContain("/api/woocommerce/plugin/download")
    expect(card).toContain("Download plugin")
  })

  it("setup guide step 1 says download from dashboard", () => {
    const card = read("app/dashboard/developer/WooCommerceIntegrationCard.tsx")
    expect(card).toContain("Download the PineTree WooCommerce plugin from this dashboard.")
    expect(card).not.toContain("onboarding contact")
  })

  it("does not reference GitHub or internal source paths", () => {
    const card = read("app/dashboard/developer/WooCommerceIntegrationCard.tsx")
    expect(card).not.toContain("github.com")
    expect(card).not.toContain("plugins/woocommerce-pinetree")
  })
})
