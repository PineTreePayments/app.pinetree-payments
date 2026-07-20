import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function shift4ModalSource(source: string) {
  // Extract from the managed-card checklist block (Stripe uses its own
  // embedded onboarding block, so it is excluded from this modal).
  // Bounded by the second occurrence (the sticky footer).
  const marker = 'isManagedCardProvider(activeProvider) && activeProvider !== "stripe" && ('
  const start = source.indexOf(marker)
  const end = source.indexOf(marker, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("Shift4 provider setup UI", () => {
  it("uses the application CTA and removes manual setup fields", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain('cta: "Start application"')
    expect(source).toContain("Shift4 Merchant Application")
    expect(source).toContain("Complete the application to begin onboarding for card and crypto payment acceptance through Shift4.")
    expect(source).toContain("Begin Application")
    expect(source).toContain("Application link not configured yet.")
    expect(source).toContain("NEXT_PUBLIC_SHIFT4_APPLICATION_URL")
    expect(source).toContain("SHIFT4_APPLICATION_URL")

    expect(source).not.toContain("Shift4 account reference")
    expect(source).not.toContain("Setup notes")
    expect(source).not.toContain("Optional internal note")
    expect(source).not.toContain("Shift4 Account Reference is required")
    expect(source).not.toContain("Shift4 provider setup saved")
  })

  it("keeps the Shift4 modal focused on the application checklist", () => {
    const source = read("app/dashboard/providers/page.tsx")
    const modal = shift4ModalSource(source)

    expect(modal).toContain("Application checklist")
    expect(modal).toContain("Business information")
    expect(modal).toContain("Banking details")
    expect(modal).toContain("Ownership details")
    expect(modal).toContain("Processing details")
    expect(modal).not.toContain("Provider setup status")
    expect(modal).not.toContain("Merchant approval")
    expect(modal).not.toContain("API access")
    expect(modal).not.toContain("Webhook return")
    expect(modal).not.toContain("Not connected")
    expect(modal).not.toContain("Not Connected")
  })

  it("keeps merchant-facing Shift4 status focused on the application", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("Provider Status")
    expect(source).toContain("Application:")
    expect(source).toContain("Not started")
    expect(source).toContain("Pending")
    expect(source).toContain("Approved")
    expect(source).toContain("Denied")
    expect(source).toContain('name: "Shift4"')
    expect(source).toContain("Managed by PineTree / {getCardProviderName(provider)}")

    expect(source).not.toContain("API access")
    expect(source).not.toContain("Webhook return")
    expect(source).not.toContain("Webhook:")
    expect(source).not.toContain("API:")
  })
})
