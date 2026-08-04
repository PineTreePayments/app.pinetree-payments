import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const READER_A = "11111111-1111-4111-8111-111111111111"
const READER_B = "22222222-2222-4222-8222-222222222222"

describe("Shift4 Retail POS reader selection", () => {
  const fetchSpy = vi.fn(() => { throw new Error("Selection must not contact Shift4") })

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_REST_ENABLED", "true")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", "PineTreePayments")
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "1.0.0")
    vi.stubEnv("SHIFT4_COMPANY_NAME", "PineTree Payments")
    vi.stubGlobal("fetch", fetchSpy)
    vi.doMock("@/database/merchantTerminalReaders", () => ({
      listMerchantTerminalReaders: async (merchantId: string, provider: string) => {
        if (merchantId !== "merchant-a" || provider !== "shift4") return []
        return [
          { id: READER_A, provider: "shift4", provider_reader_id: "PAX-1", label: "Front counter PAX", device_type: "PAX A920", serial_number: "PAX123456", terminal_location_id: "location-a", status: "configured", is_default: false },
          { id: READER_B, provider: "shift4", provider_reader_id: "VERIFONE-1", label: "Patio Verifone", device_type: "Verifone V400", serial_number: "VER123456", terminal_location_id: "location-b", status: "configured", is_default: true },
        ]
      },
    }))
    vi.doMock("@/database/merchantTerminalLocations", () => ({ getMerchantTerminalLocationById: async () => null }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.doUnmock("@/database/merchantTerminalReaders")
    vi.doUnmock("@/database/merchantTerminalLocations")
  })

  it("lists all merchant-owned readers in deterministic default-first order without claiming connectivity", async () => {
    const { listShift4RetailTerminalSelections } = await import("@/engine/shift4/retailTerminal")
    const readers = await listShift4RetailTerminalSelections("merchant-a")

    expect(readers).toHaveLength(2)
    expect(readers.map((reader) => reader.model)).toEqual(["Verifone V400", "PAX A920"])
    expect(readers[0]).toMatchObject({ readerId: READER_B, isDefault: true, connectivityState: "unverified" })
    expect(readers[1]).toMatchObject({ readerId: READER_A, isDefault: false, connectivityState: "unverified" })
    expect(JSON.stringify(readers)).not.toContain("PAX123456")
    expect(JSON.stringify(readers)).not.toContain("VER123456")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("revalidates a selected reader against the merchant and provider scope", async () => {
    const { getShift4RetailTerminalSelection } = await import("@/engine/shift4/retailTerminal")

    await expect(getShift4RetailTerminalSelection("merchant-a", READER_A)).resolves.toMatchObject({ readerId: READER_A, model: "PAX A920" })
    await expect(getShift4RetailTerminalSelection("merchant-b", READER_A)).resolves.toBeNull()
    await expect(getShift4RetailTerminalSelection("merchant-a", "not-a-reader-id")).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
