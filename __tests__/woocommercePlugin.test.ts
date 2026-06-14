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
    expect(route).toContain("being prepared")
  })

  it("503 message does not direct merchants to contact support", () => {
    const route = read("app/api/woocommerce/plugin/download/route.ts")
    expect(route).not.toContain("Contact PineTree support")
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

describe("WooCommerce plugin artifact", () => {
  const ARTIFACT = path.join(process.cwd(), "artifacts", "woocommerce", "pinetree-woocommerce.zip")

  it("ZIP artifact exists at the expected path", () => {
    expect(fs.existsSync(ARTIFACT)).toBe(true)
  })

  it("ZIP artifact is a valid ZIP file (magic bytes PK\\x03\\x04)", () => {
    const buf = fs.readFileSync(ARTIFACT)
    expect(buf.length).toBeGreaterThan(5000)
    // ZIP local file header signature
    expect(buf[0]).toBe(0x50) // P
    expect(buf[1]).toBe(0x4b) // K
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)
  })

  it("ZIP contains the plugin root PHP file", () => {
    const buf = fs.readFileSync(ARTIFACT)
    // Central directory stores file paths as text — searchable in binary
    expect(buf.toString("latin1")).toContain("woocommerce-pinetree.php")
  })

  it("ZIP contains the includes directory (gateway, admin, webhook classes)", () => {
    const buf = fs.readFileSync(ARTIFACT)
    const content = buf.toString("latin1")
    expect(content).toContain("class-pinetree-gateway")
    expect(content).toContain("class-pinetree-admin")
    expect(content).toContain("class-pinetree-webhook")
  })

  it("ZIP does not contain tests directory", () => {
    const buf = fs.readFileSync(ARTIFACT)
    expect(buf.toString("latin1")).not.toContain("tests/")
  })

  it("gitignore exception allows the artifact ZIP to be committed", () => {
    const gitignore = read(".gitignore")
    expect(gitignore).toContain("*.zip")
    expect(gitignore).toContain("!artifacts/woocommerce/pinetree-woocommerce.zip")
  })
})

describe("WooCommerce docs scope", () => {
  it("test checklist is scoped to staging or test environments, not production", () => {
    const checklist = read("docs/environment/woocommerce-test-checklist.md")
    expect(checklist.toLowerCase()).toMatch(/staging|test site|test store|test install/)
    expect(checklist).not.toMatch(/production[- ]ready|ready for production|go live/i)
    expect(checklist).not.toContain("production merchant")
  })

  it("test checklist warns against using the plugin on a production store", () => {
    const checklist = read("docs/environment/woocommerce-test-checklist.md")
    expect(checklist).toMatch(/disposable|do not install.*production|staging.*site/i)
  })

  it("WooCommerce plugin source exists and is not empty", () => {
    const plugin = read("plugins/woocommerce-pinetree/woocommerce-pinetree.php")
    expect(plugin).toContain("PineTree")
    expect(plugin).toContain("WooCommerce")
    expect(plugin).toContain("woocommerce_payment_gateways")
  })
})
