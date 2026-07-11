import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Business Profile onboarding UI", () => {
  it("keeps compact red onboarding copy where the gate blocks payments", () => {
    const dashboard = read("app/dashboard/page.tsx")
    const providers = read("app/dashboard/providers/page.tsx")
    const sharedBanner = read("components/dashboard/BusinessProfileRequirementBanner.tsx")

    for (const source of [dashboard, providers]) {
      expect(source).toContain("Complete Business Profile before continuing")
      expect(source).toContain("BusinessProfileRequirementBanner")
      expect(source).not.toContain("Business Profile Required")
      expect(source).not.toContain("Complete your Business Profile to activate wallets, providers, and live payments.")
      expect(source).not.toContain("Complete your Business Profile to activate payments.")
    }

    expect(sharedBanner).toContain("bg-red-50/70")
    expect(sharedBanner).toContain("border-red-200")
    expect(sharedBanner).toContain('const linkedWord = "continuing"')
    expect(sharedBanner).toContain("/dashboard/settings?section=business-profile&return=${returnDestination}")
    expect(sharedBanner).not.toContain("bg-red-600")
    expect(sharedBanner).not.toContain("Complete Business Profile</Link>")
    expect(dashboard).toContain('returnDestination="overview"')
    expect(providers).toContain('returnDestination="providers"')

    const businessProfileSections = [dashboard, providers]
      .map((source) => source.slice(source.indexOf("BusinessProfileRequirementBanner") - 600, source.indexOf("BusinessProfileRequirementBanner") + 1200))

    for (const section of businessProfileSections) {
      expect(section).not.toContain("bg-amber-50")
      expect(section).not.toContain("text-amber")
      expect(section).not.toContain("border-amber")
    }
  })

  it("settings page uses a Business Profile entry card and modal, not an inline full form", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const businessSection = settings.slice(
      settings.indexOf('<DashboardSection title="Business Profile"'),
      settings.indexOf('<DashboardSection title="Receipt Preferences"')
    )

    expect(businessSection).toContain("Business Profile")
    expect(businessSection).toContain("profileActionLabel(profileStatus)")
    expect(businessSection).toContain("setBusinessProfileOpen(true)")
    expect(businessSection).not.toContain("<input")
    expect(businessSection).not.toContain("BUSINESS_PROFILE_COUNTRIES.map")
    expect(settings).toContain('role="dialog"')
    expect(settings).toContain('aria-labelledby="business-profile-modal-title"')
    expect(settings).toContain("Fields marked with")
    expect(settings).toContain("Save Business Profile")
  })

  it("settings Business Profile card is compact with concise copy and a right-aligned status pill", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const businessSection = settings.slice(
      settings.indexOf('<DashboardSection title="Business Profile"'),
      settings.indexOf('<DashboardSection title="Receipt Preferences"')
    )

    expect(businessSection).toContain("Business and owner details required for payment activation.")
    expect(businessSection).toContain("flex items-center justify-between gap-3")
    expect(businessSection).toContain("shrink-0 rounded-full border px-1.5 py-px text-[10px]")
    expect(businessSection).toContain("w-full")
    expect(businessSection).not.toContain("Required business and owner information for payment activation and PineTree Wallet Lightning setup.")
    expect(businessSection).not.toContain("Complete this profile before activating payments.")
  })

  it("Business Profile status pills use gray for incomplete, blue for complete, and no green complete styling", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const toneFn = settings.slice(
      settings.indexOf("function profileStatusTone"),
      settings.indexOf("function requiredLabel")
    )

    expect(toneFn).toContain('if (status === "complete") return "border-blue-200 bg-blue-50 text-blue-700"')
    expect(toneFn).toContain('return "border-gray-200 bg-gray-50 text-gray-700"')
    expect(toneFn).toContain('if (status === "needs_attention") return "border-red-200 bg-red-50 text-red-700"')
    expect(toneFn).not.toContain("emerald")
    expect(toneFn).not.toContain("bg-amber")
  })

  it("Business Profile modal banner uses shorter payment activation copy without Lightning retry text", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const modalBlock = settings.slice(
      settings.indexOf('aria-labelledby="business-profile-modal-title"'),
      settings.indexOf('<DashboardSection title="Business Profile"')
    )

    expect(modalBlock).toContain("Payment activation")
    expect(modalBlock).toContain("Complete the required details below to activate payments.")
    expect(modalBlock).toContain("px-3 py-2")
    expect(modalBlock).toContain("text-xs font-semibold")
    expect(modalBlock).not.toContain("Payment activation requirement")
    expect(modalBlock).not.toContain("retry PineTree Wallet Lightning setup")
  })

  it("Business Profile modal marks only shared required fields with red asterisks", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const fields = read("engine/businessProfileFields.ts")

    expect(settings).toContain("isBusinessProfileFieldRequired(field)")
    expect(settings).toContain('className="text-red-600"> *</span>')
    expect(fields).toContain('"contact_email"')
    expect(fields).toContain('"owner_phone"')
    const requiredBlock = fields.slice(
      fields.indexOf("export const BUSINESS_PROFILE_REQUIRED_FIELDS"),
      fields.indexOf("export const BUSINESS_PROFILE_OPTIONAL_FIELDS")
    )
    expect(requiredBlock).not.toContain('"business_dba"')
    expect(fields).toContain('"business_dba"')
    expect(fields).toContain("BUSINESS_PROFILE_OPTIONAL_FIELDS")
  })

  it("Business Email and Owner Email prefill from Supabase signup email without overwriting saved values", () => {
    const settings = read("app/dashboard/settings/page.tsx")

    expect(settings).toContain("const authenticatedEmail = user.email ?? \"\"")
    expect(settings).toContain("setContactEmail(settings.contact_email || signupEmail)")
    expect(settings).toContain("setOwnerEmail(settings.owner_email || signupEmail)")
    expect(settings).toContain("do not silently save")
    expect(settings).not.toContain("Dynamic email")
  })

  it("wallet warning is a single compact inline link and wallet card/action stay visually unchanged", () => {
    const wallet = read("app/dashboard/wallet-setup/page.tsx")
    const sharedBanner = read("components/dashboard/BusinessProfileRequirementBanner.tsx")
    const settings = read("app/dashboard/settings/page.tsx")

    expect(wallet).toContain("Complete Business Profile before continuing")
    expect(sharedBanner).toContain("/dashboard/settings?section=business-profile&return=${returnDestination}")
    expect(wallet).toContain('returnDestination="wallet"')
    expect(wallet).toContain(">PineTree Wallet</h2>")
    expect(wallet).toContain("One merchant wallet for receiving funds and managing payments.")
    expect(wallet).toContain("<EnabledRailChips rows={walletRailRows} />")
    expect(wallet).toContain("Create PineTree Wallet")
    expect(wallet).toContain("businessProfileGateBlocking ? \"Create PineTree Wallet\"")
    expect(wallet).toContain("disabled={businessProfileGateBlocking || syncing || logoutPending || walletCreationInProgress}")
    expect(wallet).not.toContain("Complete your Business Profile before creating your PineTree Wallet.")
    expect(wallet).not.toContain("bg-red-600")
    expect(sharedBanner).toContain('const linkedWord = "continuing"')
    expect(sharedBanner).not.toContain("Complete Business Profile</Link>")
    expect(wallet).toContain("businessProfileGateReady")
    expect(wallet).toContain("blockWalletSetupForBusinessProfile")
    expect(wallet).toContain('wallet_create_blocked_business_profile_required')
    expect(wallet).toContain('wallet_speed_setup_skipped_business_profile_required')
    expect(settings).toContain('params.get("section") === "business-profile"')
    expect(settings).toContain('returnDestination === "wallet" || returnDestination === "overview" || returnDestination === "providers"')
    expect(settings).toContain("Return to PineTree Wallet")
    expect(settings).toContain("Return to Overview")
  })

  it("settings page keeps Business Profile, tax, POS, receipt, and security surfaces separate", () => {
    const settings = read("app/dashboard/settings/page.tsx")

    expect(settings).toContain('<DashboardSection title="Business Profile"')
    expect(settings).toContain('<DashboardSection title="Tax Configuration"')
    expect(settings).toContain('<DashboardSection title="POS / Operations Preferences"')
    expect(settings).toContain('<DashboardSection title="Receipt Preferences"')
    expect(settings).toContain('<DashboardSection title="Security & Integrations"')
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

  it("uses normalized country and US state selects without changing the approved banner", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const locations = read("engine/businessProfileLocation.ts")

    expect(settings).toContain("BUSINESS_PROFILE_COUNTRIES.map")
    expect(settings).toContain("US_STATES.map")
    expect(settings).toContain('renderBusinessProfileField("business_country")')
    expect(settings).toContain('renderBusinessProfileField("business_state"')
    expect(settings).toContain('renderBusinessProfileField("business_postal_code")')
    expect(locations).toContain('{ code: "US", name: "United States" }')
    expect(locations).toContain('{ code: "DC", name: "District of Columbia" }')
  })
})
