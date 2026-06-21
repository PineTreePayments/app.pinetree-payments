import { describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  ensureDefaultReceiptDevices: vi.fn(),
  listReceiptDevices: vi.fn(),
  supabase: { from: vi.fn() },
  supabaseAdmin: null
}))

import {
  getMissingSettingsRequirements,
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
