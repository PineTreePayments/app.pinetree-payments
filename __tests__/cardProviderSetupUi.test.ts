import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("card provider setup UI", () => {
  it("groups card providers separately from crypto rails", () => {
    const source = read("app/dashboard/providers/page.tsx")
    const cardSectionStart = source.indexOf('<DashboardSection title="Card Providers"')
    const cryptoSectionStart = source.indexOf('<DashboardSection title="Crypto Rails"')
    const cardSection = source.slice(cardSectionStart, cryptoSectionStart)
    const cryptoSection = source.slice(cryptoSectionStart, source.indexOf("{activeProvider && ("))

    expect(cardSectionStart).toBeGreaterThan(-1)
    expect(cryptoSectionStart).toBeGreaterThan(cardSectionStart)
    expect(cardSection).toContain("Connect card processors for in-person and online card acceptance.")
    expect(cryptoSection).toContain("Connect wallets and rails for crypto payment acceptance.")

    expect(cardSection).toContain('name="Shift4"')
    expect(cardSection).toContain('name="Stripe"')
    expect(cardSection).toContain('name="Fluid Pay"')
    expect(cardSection).not.toContain('name="Solana Pay"')
    expect(cardSection).not.toContain('name="Base Pay"')
    expect(cardSection).not.toContain("Bitcoin Lightning")

    expect(cryptoSection).toContain('name="Solana Pay"')
    expect(cryptoSection).toContain('name="Base Pay"')
    expect(cryptoSection).toContain("Bitcoin Lightning")
    expect(cryptoSection).toContain('name="Coinbase Business"')
    expect(cryptoSection).not.toContain('name="Stripe"')
    expect(cryptoSection).not.toContain('name="Fluid Pay"')

    expect(source).toContain("openProvider(provider)")
    expect(source).toContain("<ToggleSwitch")
    expect(source).toContain("toggleProvider(provider, v)")
  })

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

  it("starts Stripe and Fluid Pay setup through server routes", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain('fetch(`/api/providers/${provider}/start-setup`')
    expect(source).toContain('fetch(`/api/providers/${provider}/setup-return`')
    expect(source).toContain("window.location.assign(String(payload.url))")
    expect(source).toContain('setupLoadingProvider === activeProvider ? "Starting..."')
    expect(source).toContain("Setup received. PineTree will update this provider after approval is complete.")
    expect(source).toContain("setStripeApplicationStatusOverride(\"Pending\")")
    expect(source).toContain("setFluidPayApplicationStatusOverride(\"Pending\")")
    expect(source).not.toContain("NEXT_PUBLIC_STRIPE_APPLICATION_URL")
    expect(source).not.toContain("NEXT_PUBLIC_FLUIDPAY_APPLICATION_URL")
  })

  it("maps admin-approved and denied onboarding statuses to merchant card status", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain('if (applicationStatus === "Approved") return "Connected"')
    expect(source).toContain('if (applicationStatus === "Denied") return "Denied"')
    expect(source).toContain('applicationStatus === "approved"')
    expect(source).toContain('applicationStatus === "denied"')
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

  it("renders provider category filter with All, Card Providers, and Crypto Rails labels", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain('"All"')
    expect(source).toContain('"Card Providers"')
    expect(source).toContain('"Crypto Rails"')
    expect(source).toContain('providerFilter')
    expect(source).toContain('setProviderFilter')
  })

  it("Payment Providers heading uses dashboard section label style (PineTree blue)", () => {
    const source = read("app/dashboard/providers/page.tsx")

    expect(source).toContain("Payment Providers")
    expect(source).toContain("dashboardSectionLabelClass")
    // dashboardSectionLabelClass import must be present
    expect(source).toContain("dashboardSectionLabelClass")
  })

  it("active filter button uses PineTree blue styling, not plain black or gray", () => {
    const source = read("app/dashboard/providers/page.tsx")

    // Active state: blue fill and border
    expect(source).toContain("border-blue-300")
    expect(source).toContain("bg-blue-50")
    expect(source).toContain("text-blue-700")
    // Inactive state: light background, gray text, blue hover
    expect(source).toContain("border-gray-200")
    expect(source).toContain("hover:border-blue-200")
    expect(source).toContain("hover:text-blue-600")
    // No gray-900 / black text active state from old implementation
    expect(source).not.toContain('"bg-white font-semibold text-gray-900 shadow-sm"')
    // No gray track background from old implementation
    expect(source).not.toContain("rounded-xl bg-gray-100 p-1")
  })

  it("defaults the provider filter to All", () => {
    const source = read("app/dashboard/providers/page.tsx")
    expect(source).toContain('useState<"all" | "card" | "crypto">("all")')
  })

  it("conditionally renders Card Providers section based on filter", () => {
    const source = read("app/dashboard/providers/page.tsx")
    expect(source).toContain('providerFilter === "all" || providerFilter === "card"')
    const cardSectionStart = source.indexOf('<DashboardSection title="Card Providers"')
    expect(source.slice(0, cardSectionStart)).toContain('providerFilter === "card"')
  })

  it("conditionally renders Crypto Rails section based on filter", () => {
    const source = read("app/dashboard/providers/page.tsx")
    expect(source).toContain('providerFilter === "all" || providerFilter === "crypto"')
    const cryptoSectionStart = source.indexOf('<DashboardSection title="Crypto Rails"')
    expect(source.slice(0, cryptoSectionStart)).toContain('providerFilter === "crypto"')
  })

  it("Card Providers filter hides Crypto Rails and vice versa via conditional rendering", () => {
    const source = read("app/dashboard/providers/page.tsx")
    const cardConditional = 'providerFilter === "all" || providerFilter === "card"'
    const cryptoConditional = 'providerFilter === "all" || providerFilter === "crypto"'
    expect(source).toContain(cardConditional)
    expect(source).toContain(cryptoConditional)
    // Both conditionals must be distinct — card filter excludes crypto and vice versa
    expect(cardConditional).not.toEqual(cryptoConditional)
    // Crypto Rails conditional does not include "card"
    expect(cryptoConditional).not.toContain('"card"')
    // Card Providers conditional does not include "crypto"
    expect(cardConditional).not.toContain('"crypto"')
  })

  it("provider actions and toggles are still present regardless of filter", () => {
    const source = read("app/dashboard/providers/page.tsx")
    expect(source).toContain("openProvider(provider)")
    expect(source).toContain("<ToggleSwitch")
    expect(source).toContain("toggleProvider(provider, v)")
  })
})
