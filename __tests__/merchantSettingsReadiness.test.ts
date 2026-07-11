import { describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  ensureDefaultReceiptDevices: vi.fn(),
  listReceiptDevices: vi.fn(),
  supabase: { from: vi.fn() },
  supabaseAdmin: null
}))

import {
  getMissingSettingsRequirements,
  normalizeSettings,
  TAX_SETTINGS_NOT_READY_MESSAGE,
  normalizeTax
} from "@/engine/settingsDashboard"
import {
  normalizeBusinessCountry,
  normalizeBusinessState
} from "@/engine/businessProfileLocation"
import {
  BUSINESS_PROFILE_REQUIRED_FIELDS,
  BUSINESS_PROFILE_OPTIONAL_FIELDS,
  BUSINESS_PROFILE_FIELD_LABELS
} from "@/engine/businessProfileFields"
import { normalizeBusinessProfile } from "@/engine/businessProfile"

describe("merchant settings readiness", () => {
  it("blocks terminal readiness when required settings are missing", () => {
    expect(getMissingSettingsRequirements({
      settings: null,
      tax: null,
      operations: null,
      hasSettingsRow: false,
      hasTaxRow: false,
      hasOperationsRow: false
    })).toEqual([
      "Business name",
      "Tax enabled or disabled decision",
      "POS preferences"
    ])
  })

  it("allows readiness when taxes are disabled and settings rows exist", () => {
    expect(getMissingSettingsRequirements({
      settings: { business_name: "PineTree Shop" },
      tax: { tax_enabled: false, tax_rate: 0 },
      operations: { cash_drawer_enabled: false },
      hasSettingsRow: true,
      hasTaxRow: true,
      hasOperationsRow: true
    })).toEqual([])
  })

  it("blocks only missing tax rate when taxes are enabled", () => {
    expect(getMissingSettingsRequirements({
      settings: { business_name: "PineTree Shop" },
      tax: { tax_enabled: true, tax_rate: 0 },
      operations: { cash_drawer_enabled: false },
      hasSettingsRow: true,
      hasTaxRow: true,
      hasOperationsRow: true
    })).toEqual(["Valid tax rate"])
  })
})

describe("tax settings normalization", () => {
  it("uses a merchant-safe schema readiness message", () => {
    expect(TAX_SETTINGS_NOT_READY_MESSAGE).toBe(
      "Tax settings are not ready yet. Please refresh and try again."
    )
    expect(TAX_SETTINGS_NOT_READY_MESSAGE).not.toContain("schema cache")
  })

  it("saves taxes disabled without requiring a tax rate", () => {
    expect(normalizeTax({ tax_enabled: false, tax_rate: 0 })).toMatchObject({
      tax_enabled: false,
      tax_rate: 0
    })
  })

  it("requires a valid tax rate only when taxes are enabled", () => {
    expect(() => normalizeTax({ tax_enabled: true, tax_rate: 0 })).toThrow(
      "Tax rate is required"
    )
    expect(normalizeTax({ tax_enabled: true, tax_rate: 8.25 })).toMatchObject({
      tax_enabled: true,
      tax_rate: 8.25
    })
  })
})

describe("Business Profile settings normalization", () => {
  it("accepts realistic Business Profile field lengths", () => {
    const settings = normalizeSettings({
      legal_business_name: "L".repeat(120),
      business_dba: "D".repeat(120),
      contact_email: `${"c".repeat(242)}@example.com`,
      business_address_line1: "1".repeat(160),
      business_address_line2: "2".repeat(160),
      business_city: "C".repeat(80),
      business_state: "S".repeat(80),
      business_postal_code: "P".repeat(32),
      business_country: "CA",
      business_phone: "3".repeat(40),
      business_website: `https://example.com/${"w".repeat(180)}`,
      business_type: "retail",
      owner_first_name: "F".repeat(80),
      owner_last_name: "L".repeat(80),
      owner_email: `${"o".repeat(242)}@example.com`,
      owner_phone: "4".repeat(40),
      closeout_time: "12:00",
      report_toast: true
    })

    expect(settings.business_address_line1).toHaveLength(160)
    expect(settings.owner_email).toHaveLength(254)
  })

  it("identifies the specific overlong Business Profile field", () => {
    expect(() => normalizeSettings({
      business_address_line1: "x".repeat(241),
      closeout_time: "12:00",
      report_toast: true
    })).toThrow("Business address is too long")
  })

  it("normalizes supported country and US state codes", () => {
    expect(normalizeBusinessCountry("us")).toBe("US")
    expect(normalizeBusinessState("ky", "US")).toBe("KY")
  })

  it("uses the shared Business Profile required field definition", () => {
    expect(BUSINESS_PROFILE_REQUIRED_FIELDS).toEqual([
      "legal_business_name",
      "contact_email",
      "business_type",
      "business_country",
      "business_state",
      "business_city",
      "business_address_line1",
      "business_postal_code",
      "business_phone",
      "owner_first_name",
      "owner_last_name",
      "owner_email",
      "owner_phone",
    ])
    expect(BUSINESS_PROFILE_OPTIONAL_FIELDS).toContain("business_dba")
    expect(BUSINESS_PROFILE_FIELD_LABELS.contact_email).toBe("Business Email")
  })

  it("treats DBA as optional in backend Business Profile readiness", () => {
    const profile = normalizeBusinessProfile({
      legal_business_name: "PineTree Shop LLC",
      business_dba: "",
      contact_email: "shop@example.com",
      business_type: "retail",
      business_country: "US",
      business_state: "KY",
      business_city: "Louisville",
      business_address_line1: "123 Market St",
      business_postal_code: "40202",
      business_phone: "555-0100",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      owner_email: "ada@example.com",
      owner_phone: "555-0101",
    })

    expect(profile.business_dba).toBeNull()
    expect(profile.profile_status).toBe("complete")
    expect(profile.missing_fields).not.toContain("business_dba")
  })

  it("keeps profile incomplete when Business Email or Owner Phone is missing", () => {
    const profile = normalizeBusinessProfile({
      legal_business_name: "PineTree Shop LLC",
      business_type: "retail",
      business_country: "US",
      business_state: "KY",
      business_city: "Louisville",
      business_address_line1: "123 Market St",
      business_postal_code: "40202",
      business_phone: "555-0100",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      owner_email: "ada@example.com",
    })

    expect(profile.profile_status).toBe("incomplete")
    expect(profile.missing_fields).toContain("contact_email")
    expect(profile.missing_fields).toContain("owner_phone")
  })

  it("rejects unsupported countries and invalid US states with field-specific errors", () => {
    expect(() => normalizeBusinessCountry("United States")).toThrow(
      "Business country must be a supported country code"
    )
    expect(() => normalizeBusinessState("Kentucky", "US")).toThrow(
      "Business state must be a valid US state code"
    )
  })
})
