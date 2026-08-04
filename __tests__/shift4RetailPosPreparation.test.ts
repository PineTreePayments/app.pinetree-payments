/**
 * POS reader selection bound to Shift4 Retail payment preparation.
 *
 * Preparation must reach the provider-request boundary and STOP there: the plan
 * is validated, nothing is dispatched, and no payment, attempt, or ledger entry
 * is created.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const READER_A = "11111111-1111-4111-8111-111111111111"
const READER_B = "22222222-2222-4222-8222-222222222222"

describe("Shift4 Retail POS payment preparation", () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("Preparation must not contact Shift4")
  })

  const reader = (overrides: Record<string, unknown> = {}) => ({
    id: READER_A,
    merchant_id: "merchant-a",
    provider: "shift4",
    provider_reader_id: "TERM-0001",
    label: "Front counter",
    device_type: "PAX A35",
    serial_number: "1170301234",
    terminal_location_id: null,
    status: "configured",
    simulated: false,
    is_default: true,
    active_payment_id: null,
    last_seen_at: null,
    ...overrides,
  })

  function mount(
    rows: Record<string, unknown>[],
    options: { connection?: unknown; merchantZip?: string | null } = {}
  ) {
    const writes: string[] = []
    vi.doMock("@/database/merchantTerminalReaders", () => ({
      listMerchantTerminalReaders: async (merchantId: string, provider: string) =>
        rows.filter((row) => row.merchant_id === merchantId && row.provider === provider),
      getMerchantTerminalReaderById: async (merchantId: string, readerId: string) =>
        rows.find((row) => row.merchant_id === merchantId && row.id === readerId) ?? null,
      recordTerminalReaderProviderStatus: async () => {
        writes.push("reader_status")
        return null
      },
    }))
    vi.doMock("@/database/merchantShift4RestConnections", () => ({
      getShift4RestAccessToken: async () =>
        options.connection === undefined
          ? { accessToken: "test-access-token", connectionId: "connection-1" }
          : options.connection,
      Shift4CredentialEnvironmentMismatchError: class extends Error {},
    }))
    vi.doMock("@/database/merchants", () => ({
      getMerchantSettings: async () => ({ timezone: "America/Chicago" }),
    }))
    // Level 2 purchasing-card data needs a real postal code. The terminal
    // location carries none here, so the merchant business address supplies it.
    vi.doMock("@/database/merchantTerminalLocations", () => ({
      getMerchantTerminalLocationById: async () => null,
    }))
    vi.doMock("@/database/reports", () => ({
      getMerchantReportContext: async () => ({
        settings: { zip: options.merchantZip === undefined ? "60654" : options.merchantZip },
      }),
    }))
    // Any attempt or ledger write would show up here.
    vi.doMock("@/database/shift4PaymentAttempts", () => ({
      createShift4PaymentAttempt: async () => {
        writes.push("payment_attempt")
        return null
      },
    }))
    return { writes }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_REST_ENABLED", "true")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", "PineTreePayments")
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "1.0.0")
    vi.stubEnv("SHIFT4_COMPANY_NAME", "PineTree Payments")
    vi.stubGlobal("fetch", fetchSpy)
    fetchSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("reaches the provider boundary and stops at the disabled Retail gate", async () => {
    const { writes } = mount([reader()])
    const { prepareShift4RetailCardPayment, SHIFT4_AWAITING_RETAIL_ENABLEMENT } = await import(
      "@/engine/shift4/retailPreparation"
    )

    const preparation = await prepareShift4RetailCardPayment({
      merchantId: "merchant-a",
      readerId: READER_A,
    })

    expect(preparation.dispatchPermitted).toBe(false)
    expect(preparation.blockedReason).toBe(SHIFT4_AWAITING_RETAIL_ENABLEMENT)
    expect(preparation.providerCallPerformed).toBe(false)
    // The plan is complete enough to send the day the gate opens.
    expect(preparation.plan).toMatchObject({
      readerId: READER_A,
      manufacturer: "PAX",
      operation: "sale",
      endpoint: "/transactions/sale",
      integrationMethod: "commerce_engine_cloud",
      environment: "test",
      channel: "retail",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it("resolves the terminal server-side and never returns a raw serial number", async () => {
    mount([reader()])
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    const preparation = await prepareShift4RetailCardPayment({
      merchantId: "merchant-a",
      readerId: READER_A,
    })

    expect(preparation.plan.maskedSerial).toBe("******1234")
    expect(JSON.stringify(preparation)).not.toContain("1170301234")
    expect(JSON.stringify(preparation)).not.toContain("test-access-token")
    // The Shift4 terminal ID is not a Cloud request field and is not returned.
    expect(JSON.stringify(preparation)).not.toContain("TERM-0001")
  })

  it("names only the invoice as pending, now that purchaseCard is derived", async () => {
    mount([reader()])
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    const preparation = await prepareShift4RetailCardPayment({
      merchantId: "merchant-a",
      readerId: READER_A,
    })

    expect(preparation.plan.pendingRequiredFields).toEqual(["transaction.invoice"])
    // purchaseCard is derived from real merchant data, not an open question.
    expect(preparation.plan.pendingRequiredFields).not.toContain("transaction.purchaseCard")
    expect(preparation.plan.purchaseCardReady).toBe(true)
  })

  it("fails closed when no real postal code exists anywhere", async () => {
    // No terminal-location postal code and no merchant business ZIP. Level 2
    // data must not be completed with an invented value such as 00000.
    mount([reader()], { merchantZip: null })
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    await expect(
      prepareShift4RetailCardPayment({ merchantId: "merchant-a", readerId: READER_A })
    ).rejects.toMatchObject({ code: "postal_code_unavailable" })
  })

  it("rejects another merchant's reader generically", async () => {
    mount([reader()])
    const { prepareShift4RetailCardPayment, Shift4RetailPreparationError } = await import(
      "@/engine/shift4/retailPreparation"
    )

    await expect(
      prepareShift4RetailCardPayment({ merchantId: "merchant-b", readerId: READER_A })
    ).rejects.toMatchObject({ code: "reader_unavailable" })
    await expect(
      prepareShift4RetailCardPayment({ merchantId: "merchant-b", readerId: READER_A })
    ).rejects.toBeInstanceOf(Shift4RetailPreparationError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an unknown reader with the same message as a foreign one", async () => {
    mount([reader()])
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    const foreign = await prepareShift4RetailCardPayment({
      merchantId: "merchant-b",
      readerId: READER_A,
    }).catch((error: Error) => error.message)
    const missing = await prepareShift4RetailCardPayment({
      merchantId: "merchant-a",
      readerId: READER_B,
    }).catch((error: Error) => error.message)

    // Identical, so nothing can be learned about another tenant's readers.
    expect(foreign).toBe(missing)
  })

  it("refuses a device Shift4 reported as unregistered or offline", async () => {
    const fresh = new Date().toISOString()
    mount([reader({ status: "shift4_unregistered", last_seen_at: fresh })])
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    await expect(
      prepareShift4RetailCardPayment({ merchantId: "merchant-a", readerId: READER_A })
    ).rejects.toMatchObject({ code: "reader_not_ready" })
  })

  it("refuses a locally disabled terminal", async () => {
    mount([reader({ status: "disabled" })])
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    await expect(
      prepareShift4RetailCardPayment({ merchantId: "merchant-a", readerId: READER_A })
    ).rejects.toMatchObject({ code: "reader_not_ready" })
  })

  it("refuses when the Retail credential is missing", async () => {
    mount([reader()], { connection: null })
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    await expect(
      prepareShift4RetailCardPayment({ merchantId: "merchant-a", readerId: READER_A })
    ).rejects.toMatchObject({ code: "connection_unavailable" })
  })

  it("keeps PAX and Verifone distinct through preparation", async () => {
    mount([
      reader(),
      reader({ id: READER_B, device_type: "Verifone V660p", serial_number: "BBBB2222", is_default: false }),
    ])
    const { prepareShift4RetailCardPayment } = await import("@/engine/shift4/retailPreparation")

    const pax = await prepareShift4RetailCardPayment({ merchantId: "merchant-a", readerId: READER_A })
    const verifone = await prepareShift4RetailCardPayment({ merchantId: "merchant-a", readerId: READER_B })

    expect(pax.plan.manufacturer).toBe("PAX")
    expect(pax.plan.deviceClassification).toBe("documented_shift4_device")
    expect(verifone.plan.manufacturer).toBe("Verifone")
    expect(verifone.plan.deviceClassification).toBe("certification_scope_pending")
  })
})

describe("Shift4 Retail POS preparation route boundary", () => {
  const ROUTE = "app/api/pos/shift4-retail-preparation/route.ts"
  const SELECTOR = "components/pos/Shift4RetailReaderSelector.tsx"

  it("derives merchant identity from the signed terminal session", () => {
    const text = source(ROUTE)
    expect(text).toContain("requireTerminalSession(request)")
    // No merchant may be named by the caller.
    expect(codeOnly(text)).not.toMatch(/body\??\.\s*merchantId/)
  })

  it("accepts only a PineTree reader id, so a raw Shift4 terminal ID is refused", () => {
    const text = source(ROUTE)
    expect(text).toMatch(/UUID_PATTERN\s*=/)
    expect(text).toContain("UUID_PATTERN.test(readerId)")

    const code = codeOnly(text)
    // The parsed body is typed to exactly one optional key, so no other field
    // can be read off it even by mistake.
    expect(code).toMatch(/\{\s*readerId\?:\s*unknown\s*\}/)
    // And nothing else is ever read FROM the request body.
    const bodyReads = [...code.matchAll(/body\??\.\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1])
    expect([...new Set(bodyReads)]).toEqual(["readerId"])
  })

  it("discloses no credential or server-derived provider identity to the POS", () => {
    const code = codeOnly(source(ROUTE))
    for (const forbidden of ["accessToken", "clientGuid", "authToken", "terminalId", "serialNumber"]) {
      expect(code).not.toContain(forbidden)
    }
  })

  it("never dispatches to Shift4 from the POS route", () => {
    const code = codeOnly(source(ROUTE))
    expect(code).not.toMatch(/@\/providers\/shift4\/(rest|commerce-engine)/)
    expect(code).not.toMatch(/shift4RestRequest/)
  })

  it("sends only the reader id from the browser", () => {
    const code = codeOnly(source(SELECTOR))
    expect(code).toContain("JSON.stringify({ readerId })")
    for (const forbidden of ["merchantId", "terminalId", "serialNumber", "accessToken", "clientGuid"]) {
      expect(code).not.toContain(forbidden)
    }
  })

  it("reports the blocked reason rather than a ready state", () => {
    const text = source(SELECTOR)
    expect(text).toContain("blockedReason")
    expect(text).not.toMatch(/Terminal is online/i)
  })
})

describe("Shift4 Retail transaction safety", () => {
  it("has no PineTree type that could hold cardholder data on the Retail path", () => {
    for (const path of [
      "engine/shift4/retailPreparation.ts",
      "engine/shift4/deviceStatus.ts",
      "providers/shift4/commerce-engine/cloud/transactionRequest.ts",
      "providers/shift4/commerce-engine/cloud/deviceStatus.ts",
    ]) {
      const code = codeOnly(source(path))
      for (const forbidden of [
        "cardNumber",
        "primaryAccountNumber",
        "expirationDate",
        "securityCode",
        "trackData",
        "pinBlock",
        "p2peData",
      ]) {
        expect(code).not.toContain(forbidden)
      }
    }
  })

  it("keeps the Commerce Engine dispatch seam failing closed", async () => {
    const { HardwareGatedShift4CommerceEngineClient } = await import(
      "@/providers/shift4/commerce-engine"
    )
    const client = new HardwareGatedShift4CommerceEngineClient()

    await expect(
      client.execute({
        operation: "sale",
        invoice: "0000000001",
        amountMinor: 100,
        currency: "USD",
        terminalId: "TERM-0001",
        correlationId: "correlation-1",
      })
    ).rejects.toMatchObject({ code: "device_unavailable" })
  })

  it("no longer claims Commerce Engine documentation is unavailable", () => {
    // Shift4 publishes the Cloud contract; saying otherwise would be false.
    const code = codeOnly(source("providers/shift4/commerce-engine/client.ts"))
    expect(code).not.toContain("documentation_required")
  })
})
