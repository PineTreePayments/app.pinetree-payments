import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("card provider setup UI", () => {
  it("renders Stripe and Fluid Pay provider cards with merchant-facing setup copy", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain('name="Stripe"')
    expect(source).toContain('provider="stripe"')
    expect(source).toContain('networks="Card"')
    expect(source).toContain('settlement="Stripe merchant account"')
    expect(source).toContain("Accept card payments through Stripe once merchant onboarding is approved.")
    expect(source).toContain("Start Stripe Setup")
    expect(source).toContain("Managed by PineTree / {getCardProviderName(provider)}")

    expect(source).toContain('name="Fluid Pay"')
    expect(source).toContain('provider="fluidpay"')
    expect(source).toContain('settlement="Fluid Pay merchant account"')
    expect(source).toContain("Accept card payments through Fluid Pay once merchant onboarding is approved.")
    expect(source).toContain("Start Fluid Pay Setup")
  })

  it("renders Stripe and Fluid Pay setup modal content", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("Stripe Merchant Setup")
    expect(source).toContain("Complete setup to begin onboarding for card payment acceptance through Stripe.")
    expect(source).toContain("Fluid Pay Merchant Setup")
    expect(source).toContain("Complete setup to begin onboarding for card payment acceptance through Fluid Pay.")
    expect(source).toContain("PineTree will keep this provider status updated after approval is completed.")
    expect(source).toContain("Application checklist")
    expect(source).toContain("Business information")
    expect(source).toContain("Banking details")
    expect(source).toContain("Ownership details")
    expect(source).toContain("Processing details")
    expect(source).toContain("Begin Setup")
  })

  it("keeps Stripe and Fluid Pay setup links configurable and safely disabled by default", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("NEXT_PUBLIC_STRIPE_APPLICATION_URL")
    expect(source).toContain("NEXT_PUBLIC_FLUIDPAY_APPLICATION_URL")
    expect(source).toContain("Setup link not configured yet.")
    expect(source).toContain("disabled={!getCardProviderSetupUrl(activeProvider).trim()}")
  })

  it("keeps merchant-facing card setup free of technical processor wording", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("Application: {cardApplicationStatus || \"Not started\"}")
    expect(source).toContain("Not started")
    expect(source).toContain("Pending")
    expect(source).toContain("Approved")
    expect(source).toContain("Denied")

    expect(source).not.toContain("API access")
    expect(source).not.toContain("Webhook return")
    expect(source).not.toContain("Webhook:")
    expect(source).not.toContain("Secret keys")
    expect(source).not.toContain("Processor credentials")
    expect(source).not.toContain("Terminal configuration")
  })
})
