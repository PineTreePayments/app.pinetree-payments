/**
 * Shift4 device status — adapter behavior, normalization, freshness, ownership.
 *
 * The mapping tests are the honesty contract: `online` is reachable ONLY from
 * the exact documented combination, and an HTTP 200 on its own never is.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyShift4EvidenceFreshness,
  isShift4TerminalOnline,
  mapShift4CloudDeviceStatus,
  projectShift4TerminalReadiness,
  readShift4ReaderConnectivity,
  SHIFT4_READER_STATUS_BY_STATE,
  SHIFT4_TERMINAL_EVIDENCE_FRESHNESS_MS,
} from "@/engine/shift4/terminalReadiness"
import { EVIDENCE_FRESHNESS_MINUTES } from "@/lib/shift4/retailTerminalClient"

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

const READER_A = "11111111-1111-4111-8111-111111111111"
const READER_B = "22222222-2222-4222-8222-222222222222"

const flags = (
  cloudRegistered: "Y" | "N" | null,
  cloudConnected: "Y" | "N" | null,
  offlineMode: "Y" | "N" | "U" | null
) => ({ cloudRegistered, cloudConnected, offlineMode })

describe("Shift4 device status normalization", () => {
  it("maps Y/Y/N to online — the only combination that may", () => {
    expect(mapShift4CloudDeviceStatus(flags("Y", "Y", "N"))).toBe("online")
  })

  it("maps Y/N/N to offline", () => {
    expect(mapShift4CloudDeviceStatus(flags("Y", "N", "N"))).toBe("offline")
  })

  it("maps Y/Y/Y to offline", () => {
    // Registered and connected, but explicitly running offline.
    expect(mapShift4CloudDeviceStatus(flags("Y", "Y", "Y"))).toBe("offline")
  })

  it("maps N/N/N to unregistered", () => {
    expect(mapShift4CloudDeviceStatus(flags("N", "N", "N"))).toBe("unregistered")
  })

  it("treats an unregistered device as unregistered regardless of the other flags", () => {
    expect(mapShift4CloudDeviceStatus(flags("N", "Y", "N"))).toBe("unregistered")
  })

  it("maps the documented offlineMode 'U' to unknown, never online", () => {
    expect(mapShift4CloudDeviceStatus(flags("Y", "Y", "U"))).toBe("unknown")
  })

  it("maps missing flags to unknown, so HTTP 200 alone is never online", () => {
    expect(mapShift4CloudDeviceStatus(flags(null, null, null))).toBe("unknown")
    expect(mapShift4CloudDeviceStatus(flags("Y", "Y", null))).toBe("unknown")
    expect(mapShift4CloudDeviceStatus(flags("Y", null, "N"))).toBe("unknown")
  })

  it("never returns online for any combination other than Y/Y/N", () => {
    const values = ["Y", "N", null] as const
    const offline = ["Y", "N", "U", null] as const
    for (const registered of values) {
      for (const connected of values) {
        for (const mode of offline) {
          const state = mapShift4CloudDeviceStatus(flags(registered, connected, mode))
          if (state === "online") {
            expect([registered, connected, mode]).toEqual(["Y", "Y", "N"])
          }
        }
      }
    }
  })
})

describe("Shift4 device status evidence and freshness", () => {
  const observedAt = "2026-08-04T12:00:00.000Z"
  const withinWindow = new Date("2026-08-04T12:04:00.000Z")
  const pastWindow = new Date("2026-08-04T12:30:00.000Z")

  it("keeps a conservative freshness window that the browser copy agrees with", () => {
    expect(SHIFT4_TERMINAL_EVIDENCE_FRESHNESS_MS).toBe(5 * 60 * 1000)
    expect(EVIDENCE_FRESHNESS_MINUTES * 60 * 1000).toBe(SHIFT4_TERMINAL_EVIDENCE_FRESHNESS_MS)
  })

  it("reads a namespaced provider status as provider evidence", () => {
    const evidence = readShift4ReaderConnectivity(
      { status: SHIFT4_READER_STATUS_BY_STATE.online, last_seen_at: observedAt },
      withinWindow
    )
    expect(evidence).toMatchObject({
      state: "online",
      source: "shift4_status_operation",
      observedAt,
      stale: false,
    })
    expect(isShift4TerminalOnline(evidence)).toBe(true)
  })

  it("never reads a locally written status as provider evidence", () => {
    // These are the strings PineTree's own configuration writes.
    for (const status of ["ready", "online", "active", "connected", "configured", ""]) {
      const evidence = readShift4ReaderConnectivity({ status, last_seen_at: observedAt }, withinWindow)
      expect(evidence.state).toBe("unverified")
      expect(evidence.source).toBe("none")
      expect(isShift4TerminalOnline(evidence)).toBe(false)
    }
  })

  it("downgrades stale evidence so it is not shown as current connectivity", () => {
    const evidence = readShift4ReaderConnectivity(
      { status: SHIFT4_READER_STATUS_BY_STATE.online, last_seen_at: observedAt },
      pastWindow
    )
    expect(evidence.state).toBe("unverified")
    expect(evidence.stale).toBe(true)
    // The timestamp survives so the UI can still say when it was last checked.
    expect(evidence.observedAt).toBe(observedAt)
    expect(isShift4TerminalOnline(evidence)).toBe(false)
  })

  it("treats an unparseable timestamp as unknown rather than current", () => {
    const evidence = applyShift4EvidenceFreshness(
      { state: "online", source: "shift4_status_operation", observedAt: "not-a-date", stale: false },
      withinWindow
    )
    expect(evidence.state).toBe("unknown")
    expect(evidence.stale).toBe(true)
  })

  it("blocks readiness on every non-online provider state", () => {
    const base = {
      configuredCount: 1,
      configurationAvailable: true,
      restApiEnabled: true,
      retailEnabled: true,
      certified: true,
      productionAllowed: true,
    }
    const evidence = (state: "unregistered" | "offline" | "unknown" | "online") => ({
      state,
      source: "shift4_status_operation" as const,
      observedAt,
      stale: false,
    })

    expect(projectShift4TerminalReadiness({ ...base, connectivity: evidence("unregistered") })).toMatchObject({
      state: "unregistered",
      ready: false,
    })
    expect(projectShift4TerminalReadiness({ ...base, connectivity: evidence("offline") })).toMatchObject({
      state: "offline",
      ready: false,
    })
    expect(projectShift4TerminalReadiness({ ...base, connectivity: evidence("unknown") })).toMatchObject({
      state: "unknown",
      ready: false,
    })
    // Only a fully passing chain reports enabled.
    expect(projectShift4TerminalReadiness({ ...base, connectivity: evidence("online") })).toMatchObject({
      state: "enabled",
      ready: true,
    })
  })

  it("stops stale online evidence short of enabled", () => {
    const projection = projectShift4TerminalReadiness({
      configuredCount: 1,
      configurationAvailable: true,
      restApiEnabled: true,
      retailEnabled: true,
      certified: true,
      productionAllowed: true,
      connectivity: readShift4ReaderConnectivity(
        { status: SHIFT4_READER_STATUS_BY_STATE.online, last_seen_at: observedAt },
        pastWindow
      ),
    })
    expect(projection.state).toBe("configured")
    expect(projection.ready).toBe(false)
  })
})

describe("Shift4 device status adapter", () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("No provider request was expected")
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

  /** Mount the database layer with a controllable in-memory reader set. */
  function mount(rows: Record<string, unknown>[], options: { connection?: unknown } = {}) {
    const recorded: Record<string, unknown>[] = []
    vi.doMock("@/database/merchantTerminalReaders", () => ({
      listMerchantTerminalReaders: async (merchantId: string, provider: string) =>
        rows.filter((row) => row.merchant_id === merchantId && row.provider === provider),
      getMerchantTerminalReaderById: async (merchantId: string, readerId: string) =>
        rows.find((row) => row.merchant_id === merchantId && row.id === readerId) ?? null,
      recordTerminalReaderProviderStatus: async (input: Record<string, unknown>) => {
        recorded.push(input)
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
    return { recorded }
  }

  /** One documented 200 response, then a spy that fails if called twice. */
  function respondOnce(body: unknown) {
    const calls: { url: string; init: RequestInit }[] = []
    const impl = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    return { impl: impl as unknown as typeof fetch, calls }
  }

  it("sends no request when no terminal is configured", async () => {
    mount([])
    const { verifyShift4RetailDeviceStatus, Shift4DeviceStatusError } = await import(
      "@/engine/shift4/deviceStatus"
    )
    const { impl, calls } = respondOnce({ result: [{}] })

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toMatchObject({ code: "not_configured" })
    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toBeInstanceOf(Shift4DeviceStatusError)

    expect(calls).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("posts exactly once to /devices/getstatus with the documented Cloud body", async () => {
    mount([reader()])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({
      result: [{ cloudRegistered: "Y", cloudConnected: "Y", offlineMode: "N" }],
    })

    const result = await verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.shift4test.com/api/rest/v1/devices/getstatus")
    expect(calls[0].init.method).toBe("POST")

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["dateTime", "device"])
    expect(body.device).toEqual({ cloud: true, manufacturer: "PAX", serialNumber: "1170301234" })
    expect(String(body.dateTime)).toMatch(/[+-]\d{2}:\d{2}$/)

    expect(result.connectivityState).toBe("online")
    expect(result.cloudRegistered).toBe("Y")
    expect(result.providerCallPerformed).toBe(true)
  })

  it("never retries automatically", async () => {
    mount([reader()])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const impl = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toBeTruthy()
    expect(impl).toHaveBeenCalledTimes(1)
  })

  it("returns only safe fields and never the raw response or a credential", async () => {
    mount([reader()])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl } = respondOnce({
      result: [
        {
          cloudRegistered: "Y",
          cloudConnected: "Y",
          offlineMode: "N",
          // Material a future Shift4 addition might include. None may escape.
          accessToken: "SECRET-TOKEN",
          card: { number: "4111111111111111" },
        },
      ],
    })

    const result = await verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain("SECRET-TOKEN")
    expect(serialized).not.toContain("4111111111111111")
    expect(serialized).not.toContain("test-access-token")
    // The full serial never leaves; only the masked form.
    expect(serialized).not.toContain("1170301234")
    expect(result.maskedSerial).toBe("******1234")
  })

  it("persists a namespaced provider status with the evidence timestamp", async () => {
    const { recorded } = mount([reader()])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl } = respondOnce({
      result: [{ cloudRegistered: "Y", cloudConnected: "N", offlineMode: "N" }],
    })

    const result = await verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })

    expect(result.connectivityState).toBe("offline")
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      merchantId: "merchant-a",
      readerId: READER_A,
      provider: "shift4",
      status: "shift4_offline",
    })
    // Namespaced so it can never be confused with local configuration.
    expect(String(recorded[0].status)).toMatch(/^shift4_/)
  })

  it("requires an explicit choice when the merchant owns several terminals", async () => {
    mount([reader(), reader({ id: READER_B, provider_reader_id: "TERM-0002", is_default: false })])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({ result: [{}] })

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toMatchObject({ code: "selection_required" })
    // No implicit readers[0], and therefore no request at all.
    expect(calls).toHaveLength(0)
  })

  it("checks each chosen terminal independently", async () => {
    mount([
      reader({ serial_number: "AAAA1111" }),
      reader({ id: READER_B, provider_reader_id: "TERM-0002", device_type: "Verifone UX700", serial_number: "BBBB2222", is_default: false }),
    ])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({
      result: [{ cloudRegistered: "Y", cloudConnected: "Y", offlineMode: "N" }],
    })

    const first = await verifyShift4RetailDeviceStatus({
      merchantId: "merchant-a",
      readerId: READER_A,
      fetchImpl: impl,
    })
    const second = await verifyShift4RetailDeviceStatus({
      merchantId: "merchant-a",
      readerId: READER_B,
      fetchImpl: impl,
    })

    expect(calls).toHaveLength(2)
    expect(JSON.parse(String(calls[0].init.body)).device).toMatchObject({
      manufacturer: "PAX",
      serialNumber: "AAAA1111",
    })
    // PAX and Verifone stay distinct all the way into the request.
    expect(JSON.parse(String(calls[1].init.body)).device).toMatchObject({
      manufacturer: "Verifone",
      serialNumber: "BBBB2222",
    })
    expect(first.readerId).toBe(READER_A)
    expect(second.readerId).toBe(READER_B)
    expect(second.deviceClassification).toBe("certification_scope_pending")
  })

  it("refuses a reader belonging to another merchant, without sending anything", async () => {
    mount([reader()])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({ result: [{}] })

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-b", readerId: READER_A, fetchImpl: impl })
    ).rejects.toMatchObject({ code: "not_configured" })
    expect(calls).toHaveLength(0)
  })

  it("refuses a reader with no serial number, because Cloud addresses by serial", async () => {
    mount([reader({ serial_number: null })])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({ result: [{}] })

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toMatchObject({ code: "serial_number_missing" })
    expect(calls).toHaveLength(0)
  })

  it("refuses a simulated reader", async () => {
    mount([reader({ simulated: true })])
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({ result: [{}] })

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toMatchObject({ code: "simulated_reader" })
    expect(calls).toHaveLength(0)
  })

  it("refuses when no Retail credential is stored", async () => {
    mount([reader()], { connection: null })
    const { verifyShift4RetailDeviceStatus } = await import("@/engine/shift4/deviceStatus")
    const { impl, calls } = respondOnce({ result: [{}] })

    await expect(
      verifyShift4RetailDeviceStatus({ merchantId: "merchant-a", fetchImpl: impl })
    ).rejects.toMatchObject({ code: "connection_unavailable" })
    expect(calls).toHaveLength(0)
  })
})

describe("Shift4 device status route boundary", () => {
  const ROUTE = "app/api/internal/shift4/retail-terminal/verification/route.ts"

  it("authorizes the operator before touching the body", () => {
    const text = source(ROUTE)
    const authIndex = text.indexOf("requireShift4OperatorFromRequest(request)")
    const bodyIndex = text.indexOf("readReaderSelection(request)")
    expect(authIndex).toBeGreaterThan(-1)
    expect(bodyIndex).toBeGreaterThan(authIndex)
  })

  it("accepts only readerId and rejects every server-derived field", () => {
    const text = source(ROUTE)
    expect(text).toContain('ALLOWED_BODY_KEYS = new Set(["readerId"])')
    expect(text).toContain("caller_input_not_accepted")
    // A Shift4 terminal ID cannot satisfy a PineTree row-id pattern.
    expect(text).toMatch(/UUID_PATTERN\s*=/)
  })

  it("returns no raw provider material", () => {
    const text = source(ROUTE)
    for (const forbidden of ["accessToken", "clientGuid", "rawResponse", "serialNumber:"]) {
      expect(text).not.toContain(forbidden)
    }
  })
})
