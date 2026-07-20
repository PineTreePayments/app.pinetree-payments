import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  testMode: true,
  locations: [] as Array<Record<string, unknown>>,
  readers: [] as Array<Record<string, unknown>>,
  registerSimulated: vi.fn(),
  registerPhysical: vi.fn(),
  getLocation: vi.fn(),
  upsertReader: vi.fn(),
  setDefault: vi.fn()
}))

vi.mock("@/providers/stripe", () => ({
  isStripeTestMode: () => mocks.testMode,
  resolveStripeConnectChargeContext: () => ({ chargeModel: "direct" }),
  registerSimulatedStripeReader: mocks.registerSimulated,
  registerStripeTerminalReader: mocks.registerPhysical
}))

vi.mock("@/engine/stripeConnect", () => ({
  getStripeTerminalReadiness: vi.fn().mockResolvedValue({ ready: true, accountId: "acct_connected_merchant" }),
  getStripeCardProviderContext: vi.fn().mockResolvedValue({
    accountId: "acct_connected_merchant",
    onlineEnabled: true,
    connection: { chargesEnabled: true },
    settings: { inPersonEnabled: true, manualEntryEnabled: true, routingPreference: "automatic" }
  })
}))

vi.mock("@/database/merchantTerminalLocations", () => ({
  listMerchantTerminalLocations: () => Promise.resolve(mocks.locations),
  getMerchantTerminalLocationById: mocks.getLocation,
  upsertMerchantTerminalLocation: vi.fn()
}))

vi.mock("@/database/merchantTerminalReaders", () => ({
  listMerchantTerminalReaders: () => Promise.resolve(mocks.readers),
  getMerchantTerminalReaderById: vi.fn(),
  upsertMerchantTerminalReader: mocks.upsertReader,
  setMerchantDefaultTerminalReader: mocks.setDefault,
  claimTerminalReaderForPayment: vi.fn(),
  getTerminalReaderByActivePayment: vi.fn(),
  releaseTerminalReaderClaim: vi.fn()
}))

vi.mock("@/database/payments", () => ({
  createPayment: vi.fn(),
  getPaymentById: vi.fn(),
  updatePaymentMetadata: vi.fn(),
  updatePaymentProviderReference: vi.fn()
}))
vi.mock("@/engine/posPayments", () => ({ calculatePosTotalsForTerminal: vi.fn() }))
vi.mock("@/engine/eventProcessor", () => ({ advancePaymentToTargetStatus: vi.fn() }))

import {
  createSimulatedTerminalReaderEngine,
  registerTerminalReaderEngine
} from "@/engine/stripeTerminal"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("Stripe Terminal merchant setup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.testMode = true
    mocks.locations = []
    mocks.readers = []
    mocks.getLocation.mockImplementation(async (_merchantId: string, locationId: string) =>
      mocks.locations.find((location) => location.id === locationId) || null
    )
    mocks.registerSimulated.mockResolvedValue({
      id: "tmr_simulated",
      label: "PineTree simulated reader",
      deviceType: "simulated_wisepos_e",
      serialNumber: null,
      status: "online",
      locationId: "tml_provider",
      simulated: true,
      livemode: false
    })
    mocks.upsertReader.mockImplementation(async (input: Record<string, unknown>) => {
      const row = {
        id: "reader_local",
        merchant_id: input.merchantId,
        terminal_location_id: input.terminalLocationId,
        provider: "stripe",
        provider_reader_id: input.providerReaderId,
        label: input.label,
        device_type: input.deviceType,
        serial_number: input.serialNumber,
        status: input.status,
        simulated: input.simulated,
        is_default: false,
        active_payment_id: null,
        last_seen_at: null
      }
      mocks.readers.push(row)
      return row
    })
    mocks.setDefault.mockImplementation(async (_merchantId: string, readerId: string) => {
      mocks.readers.forEach((reader) => { reader.is_default = reader.id === readerId })
    })
  })

  it("requires a merchant-created Terminal Location for a Sandbox Reader", async () => {
    await expect(createSimulatedTerminalReaderEngine("merchant_1"))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("Terminal Location") })
    expect(mocks.registerSimulated).not.toHaveBeenCalled()
  })

  it("creates and persists a simulated first reader as default in test mode without a client registration code", async () => {
    mocks.locations = [{
      id: "location_local",
      merchant_id: "merchant_1",
      provider: "stripe",
      provider_location_id: "tml_provider",
      display_name: "Main Store",
      address: {},
      status: "active"
    }]

    const reader = await createSimulatedTerminalReaderEngine("merchant_1", { terminalLocationId: "location_local" })

    expect(mocks.registerSimulated).toHaveBeenCalledWith({
      connectedAccountId: "acct_connected_merchant",
      stripeLocationId: "tml_provider"
    })
    expect(mocks.registerSimulated.mock.calls[0][0]).not.toHaveProperty("registrationCode")
    expect(mocks.upsertReader).toHaveBeenCalledWith(expect.objectContaining({ simulated: true }))
    expect(mocks.setDefault).toHaveBeenCalledWith("merchant_1", "reader_local")
    expect(reader).toMatchObject({ id: "reader_local", simulated: true, isDefault: true, status: "online" })
  })

  it("fails closed for live Stripe keys before creating a simulated reader", async () => {
    mocks.testMode = false
    await expect(createSimulatedTerminalReaderEngine("merchant_1", { terminalLocationId: "location_local" }))
      .rejects.toMatchObject({ status: 403 })
    expect(mocks.registerSimulated).not.toHaveBeenCalled()
  })

  it("blocks physical registration before accepting a registration code when no location is selected", async () => {
    await expect(registerTerminalReaderEngine("merchant_1", {
      registrationCode: "secret-reader-code",
      terminalLocationId: ""
    })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Terminal Location") })
    expect(mocks.registerPhysical).not.toHaveBeenCalled()
  })
})

describe("Stripe Terminal setup UI and POS wiring", () => {
  const dashboard = read("components/dashboard/StripeTerminalSettings.tsx")
  const providersPage = read("app/dashboard/providers/page.tsx")
  const posCard = read("components/pos/PosCardPaymentExperience.tsx")
  const posLayout = read("components/pos/POSLayout.tsx")
  const capabilities = read("engine/stripeTerminal.ts")

  it("shows location setup under Providers → Stripe with every required address field", () => {
    expect(providersPage).toContain('activeProvider === "stripe"')
    expect(providersPage).toContain("<StripeTerminalSettings />")
    expect(dashboard).toContain("Stripe Terminal Location Required")
    for (const label of ["Display name", "Address line 1", "Address line 2, optional", "City", "State", "Postal code", "Country"]) {
      expect(dashboard).toContain(label)
    }
  })

  it("offers complete reader actions and keeps the Tap to Pay routing option informational only, without a merchant-facing Tap to Pay card", () => {
    for (const action of ["Register Physical Reader", "Create Sandbox Reader", "Refresh Readers", "Set Default Reader"]) {
      expect(dashboard).toContain(action)
    }
    expect(dashboard).not.toContain("Native PineTree mobile app required")
    expect(dashboard).not.toContain("future native application using the Stripe Terminal SDK")
    expect(dashboard).not.toMatch(/Enable Tap to Pay/)
    expect(dashboard).toContain('<option value="tap_to_pay_first" disabled>')
  })

  it("guides no-reader POS setup locally and refreshes after Sandbox Reader creation", () => {
    const noReader = posCard.slice(posCard.indexOf('props.view === "no-reader"'), posCard.indexOf('props.view === "setup"'))
    expect(noReader).toContain("Refresh Readers")
    expect(noReader).toContain("Set Up Stripe Terminal")
    expect(noReader).toContain("Create Sandbox Reader")
    expect(noReader).not.toContain("generic Settings")
    expect(noReader).not.toContain("Register Reader")
    expect(posCard).toContain("Stripe Terminal Location Required")
    expect(posCard).toContain("Sandbox Reader")
    expect(posLayout).toContain('fetch("/api/providers/stripe/terminal/readers/simulated"')
    expect(posLayout).toContain("await loadCardCapabilities(true)")
    expect(posLayout).toContain('fetch("/api/providers/stripe/terminal/readers/simulate-payment"')
  })

  it("keeps PineTree POS registers separate from Stripe readers and browser Tap to Pay unavailable", () => {
    expect(posLayout).toContain("readerId: reader.id")
    expect(posLayout).not.toContain("readerId: terminalContext?.terminalId")
    expect(capabilities).toContain('clientContext.platform !== "native"')
    expect(capabilities).toContain('{ available: false, reason: "native_app_required" }')
  })
})
