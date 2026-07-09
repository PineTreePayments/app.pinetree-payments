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
  normalizeTax
} from "@/engine/settingsDashboard"

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
      business_country: "US",
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
})
