import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Business Profile onboarding UI", () => {
  it("uses compact red onboarding copy and styling across dashboard surfaces", () => {
    const dashboard = read("app/dashboard/page.tsx")
    const settings = read("app/dashboard/settings/page.tsx")
    const providers = read("app/dashboard/providers/page.tsx")
    const wallet = read("app/dashboard/wallet-setup/page.tsx")

    for (const source of [dashboard, settings, providers, wallet]) {
      expect(source).toContain("Business Profile Required")
      expect(source).toContain("Complete your Business Profile to activate wallets, providers, and live payments.")
      expect(source).toContain("Complete Business Profile")
      expect(source).toContain("bg-red-50/70")
      expect(source).toContain("border-red-200")
      expect(source).not.toContain("Complete your Business Profile to activate payments.")
    }

    const businessProfileSections = [dashboard, settings, providers, wallet]
      .map((source) => source.slice(source.indexOf("Business Profile Required") - 600, source.indexOf("Business Profile Required") + 1200))

    for (const section of businessProfileSections) {
      expect(section).not.toContain("bg-amber-50")
      expect(section).not.toContain("text-amber")
      expect(section).not.toContain("border-amber")
    }
  })

  it("does not show the stale June 7 settings migration warning by default", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const settingsEngine = read("engine/settingsDashboard.ts")

    expect(settings).not.toContain("Settings database migration required")
    expect(settings).not.toContain("Apply the June 7, 2026 merchant operations settings migration")
    expect(settingsEngine).not.toContain("Settings database migration required")
  })

  it("keeps schema warning behavior tied to actual schema errors", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const settingsEngine = read("engine/settingsDashboard.ts")

    expect(settingsEngine).toContain("settingsResult.error && isSchemaMissing")
    expect(settingsEngine).toContain("operationsResult.error")
    expect(settingsEngine).toContain("MERCHANT_SETTINGS_SELECT_COLUMNS")
    expect(settingsEngine).toContain("\"business_dba\"")
    expect(settingsEngine).toContain("\"owner_first_name\"")
    expect(settingsEngine).toContain("\"profile_status\"")
    expect(settingsEngine).not.toContain("if (!deviceResult.available) schemaReady = false")
    expect(settingsEngine).toContain("Settings schema update required before saving extended preferences")
    expect(settings).toContain("settingsLoadWarning")
    expect(settings).toContain("payload.schemaReady === false")
    expect(settings).not.toContain("{!schemaReady && (")
  })
})
