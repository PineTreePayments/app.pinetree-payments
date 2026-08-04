/**
 * Shift4 Retail terminal configuration, verification, and corrected readiness
 * labels.
 *
 * Covers three contracts:
 *
 *   1. READINESS LABELS - a capability whose credential or configuration is
 *      absent reports "Not configured", never "Configured" and never "Disabled".
 *   2. TERMINAL - configuration is stored in the existing merchant terminal
 *      tables, scoped to provider "shift4", with no silent duplicate and no
 *      provider request; "online" is unreachable without provider evidence.
 *   3. SECRECY AND AUTHORIZATION - operator-only routes, server-derived
 *      identity, and no credential, serial, or provider payload on any path.
 *
 * NO NETWORK REQUEST IS MADE: `fetch` is replaced with a throwing stub for
 * every test, and the database is an in-memory object.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  isShift4TerminalOnline,
  projectShift4TerminalReadiness,
  resolveShift4TerminalConnectivity,
  SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED,
  type Shift4TerminalConnectivityEvidence,
} from "@/engine/shift4/terminalReadiness"

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), "utf8")

/**
 * Strip comments before asserting on code.
 *
 * Prose about what a module does not do would otherwise match a search for the
 * very thing being forbidden.
 */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const ENGINE = "engine/shift4/retailTerminal.ts"
const TERMINAL_ROUTE = "app/api/internal/shift4/retail-terminal/route.ts"
const VERIFY_ROUTE = "app/api/internal/shift4/retail-terminal/verification/route.ts"
const CLIENT = "lib/shift4/retailTerminalClient.ts"
const CARD = "components/dashboard/Shift4RetailTerminalCard.tsx"
const DEVELOPMENT_CARD = "components/dashboard/Shift4RetailDevelopmentReadinessCard.tsx"
const ADMIN_SECTION = "components/admin/Shift4SandboxOperationsSection.tsx"
const PROVIDERS_PAGE = "app/dashboard/providers/page.tsx"

/** The exact safe field set both terminal routes may return. */
const SAFE_TERMINAL_FIELDS = [
  "readerId",
  "terminalId",
  "model",
  "maskedSerial",
  "locationId",
  "integrationMethod",
  "environment",
  "channel",
  "configured",
  "connectivityState",
  "evidenceSource",
  "lastVerifiedAt",
  "correlationId",
  "readinessState",
  "retailProcessingEnabled",
]

const evidence = (
  state: Shift4TerminalConnectivityEvidence["state"],
  source: Shift4TerminalConnectivityEvidence["source"] = "shift4_status_operation"
): Shift4TerminalConnectivityEvidence => ({ state, source, observedAt: "2026-08-03T00:00:00.000Z" })

const BASE_PROJECTION = {
  configuredCount: 1,
  configurationAvailable: true,
  restApiEnabled: true,
  retailEnabled: true,
  connectivity: SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED,
  certified: false,
  productionAllowed: false,
}

describe("Shift4 Retail terminal", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_REST_ENABLED", "true")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", "PineTreePayments")
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "1.0.0")
    vi.stubEnv("SHIFT4_COMPANY_NAME", "PineTree Payments")

    fetchSpy = vi.fn(() => {
      throw new Error("A network request was attempted during a terminal test.")
    })
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.doUnmock("@/database/merchantTerminalReaders")
    vi.doUnmock("@/database/merchantTerminalLocations")
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /* ════════════════════════════════════════════════════════════════════════
     1. READINESS LABELS
     ════════════════════════════════════════════════════════════════════════ */

  describe("corrected readiness labels", () => {
    /** Resolve readiness for a merchant holding ONLY a Retail credential. */
    async function retailOnlyReadiness(
      overrides: Record<string, unknown> = {},
      flagOverrides: Record<string, boolean> = {}
    ) {
      const { resolveShift4Readiness } = await import("@/engine/shift4/readiness")
      return resolveShift4Readiness("merchant-1", {
        flags: Object.freeze({
          restApi: true, ecommerce: false, retail: false, certificationMode: false,
          manualAuthorization: false, partialApproval: false, splitTender: false,
          applePay: false, googlePay: false, production: false,
          onboardingRequired: false, commerceEngineConfigured: false,
          ...flagOverrides,
        }),
        getConnection: async () => ({
          connectionId: "connection-1", status: "connected", enabled: true, connected: true,
          environment: "test" as const, accessTokenPresent: true,
          accessTokenFingerprint: "fingerprint", interfaceName: null, interfaceVersion: null,
          companyName: null, connectedAt: null, lastExchangeCorrelationId: null,
          lastExchangeServerName: null, channel: "retail" as const,
          channels: {
            retail: {
              accessTokenPresent: true, accessTokenFingerprint: "fingerprint",
              environment: "test" as const, interfaceName: null, interfaceVersion: null,
              companyName: null, connectedAt: null, lastExchangeCorrelationId: null,
              lastExchangeServerName: null, cardProcessingVerified: false,
            },
            ecommerce: null,
          },
          legacySharedCredentialPresent: false,
          credentialVersion: 2,
          cardProcessingVerified: false,
        }),
        listReaders: async () => [],
        getOnboarding: async () => null,
        i4goConfigured: false,
        ...overrides,
      })
    }

    it("reports E-commerce as Not configured when no E-commerce credential exists", async () => {
      const result = await retailOnlyReadiness()

      expect(result.capabilities.ecommerce.state).toBe("not_configured")
      expect(result.capabilities.ecommerce.ready).toBe(false)
      expect(result.capabilities.ecommerce.reason).toMatch(/No E-commerce credential/i)
    })

    it("reports Apple Pay and Google Pay as Not configured", async () => {
      const result = await retailOnlyReadiness()

      for (const wallet of ["apple_pay", "google_pay"] as const) {
        expect(result.capabilities[wallet].state, wallet).toBe("not_configured")
        expect(result.capabilities[wallet].ready, wallet).toBe(false)
      }
    })

    it("never reports a wallet as Configured merely because its flag is off", async () => {
      // The precise defect: the row existed, so the state read "Configured"
      // while the reason said no credential was connected.
      for (const applePay of [true, false]) {
        const result = await retailOnlyReadiness({}, { applePay, googlePay: applePay })
        expect(result.capabilities.apple_pay.state, `applePay=${applePay}`).not.toBe("configured")
        expect(result.capabilities.google_pay.state, `applePay=${applePay}`).not.toBe("configured")
      }
    })

    it("requires i4Go configuration before E-commerce may be called configured", async () => {
      // Credential present, gate on, i4Go absent: still not configured, because
      // PineTree cannot take a card without i4Go tokenization.
      const withCredential = {
        getConnection: async () => ({
          connectionId: "connection-1", status: "connected", enabled: true, connected: true,
          environment: "test" as const, accessTokenPresent: true,
          accessTokenFingerprint: "fingerprint", interfaceName: null, interfaceVersion: null,
          companyName: null, connectedAt: null, lastExchangeCorrelationId: null,
          lastExchangeServerName: null, channel: "ecommerce" as const,
          channels: {
            retail: null,
            ecommerce: {
              accessTokenPresent: true, accessTokenFingerprint: "fingerprint",
              environment: "test" as const, interfaceName: null, interfaceVersion: null,
              companyName: null, connectedAt: null, lastExchangeCorrelationId: null,
              lastExchangeServerName: null, cardProcessingVerified: false,
            },
          },
          legacySharedCredentialPresent: false,
          credentialVersion: 2,
          cardProcessingVerified: false,
        }),
      }

      const missing = await retailOnlyReadiness(withCredential, { ecommerce: true })
      expect(missing.capabilities.ecommerce.state).toBe("not_configured")
      expect(missing.capabilities.ecommerce.reason).toMatch(/i4Go/i)

      const present = await retailOnlyReadiness(
        { ...withCredential, i4goConfigured: true },
        { ecommerce: true }
      )
      expect(present.capabilities.ecommerce.state).toBe("certification_required")
    })

    it("keeps configured, disabled, certification-required, and enabled distinct", async () => {
      const connection = {
        connectionId: "connection-1", status: "connected", enabled: true, connected: true,
        environment: "test" as const, accessTokenPresent: true,
        accessTokenFingerprint: "fingerprint", interfaceName: null, interfaceVersion: null,
        companyName: null, connectedAt: null, lastExchangeCorrelationId: null,
        lastExchangeServerName: null, channel: "shared" as const,
        channels: { retail: null, ecommerce: null },
        legacySharedCredentialPresent: true,
        credentialVersion: 1,
        cardProcessingVerified: false,
      }

      // Gate off, everything else present -> disabled.
      const disabled = await retailOnlyReadiness(
        { getConnection: async () => connection, i4goConfigured: true },
        { ecommerce: false }
      )
      expect(disabled.capabilities.ecommerce.state).toBe("disabled")

      // Gate on, uncertified -> certification required.
      const certification = await retailOnlyReadiness(
        { getConnection: async () => connection, i4goConfigured: true },
        { ecommerce: true }
      )
      expect(certification.capabilities.ecommerce.state).toBe("certification_required")

      // Certified as well -> enabled.
      const enabled = await retailOnlyReadiness(
        {
          getConnection: async () => ({ ...connection, cardProcessingVerified: true }),
          i4goConfigured: true,
        },
        { ecommerce: true }
      )
      expect(enabled.capabilities.ecommerce.state).toBe("enabled")
      expect(enabled.capabilities.ecommerce.ready).toBe(true)
    })

    it("keeps Retail authentication separate from Retail processing", async () => {
      const result = await retailOnlyReadiness()

      // Authenticated, yet processing stays off: two independent facts.
      expect(result.authenticatedChannels.retail).toBe(true)
      expect(result.capabilities.merchant_authentication.state).toBe("authenticated")
      expect(result.capabilities.retail.state).toBe("disabled")
      expect(result.capabilities.retail.reason).toMatch(/Retail feature gate is off/)
      expect(result.processingEnabled).toBe(false)
    })

    it("preserves the accurate production and certification states", async () => {
      const result = await retailOnlyReadiness()

      expect(result.capabilities.certification.state).toBe("disabled")
      expect(result.capabilities.production_processing.state).toBe("blocked")
      expect(result.capabilities.terminal.state).toBe("not_configured")
    })
  })

  /* ════════════════════════════════════════════════════════════════════════
     2. TERMINAL READINESS PROJECTION
     ════════════════════════════════════════════════════════════════════════ */

  describe("terminal readiness projection", () => {
    it("reports not_configured when no Shift4 terminal row exists", () => {
      const result = projectShift4TerminalReadiness({ ...BASE_PROJECTION, configuredCount: 0 })
      expect(result.state).toBe("not_configured")
      expect(result.ready).toBe(false)
    })

    it("reports disabled when a terminal exists but the Retail gate is off", () => {
      const result = projectShift4TerminalReadiness({ ...BASE_PROJECTION, retailEnabled: false })
      expect(result.state).toBe("disabled")
      expect(result.reason).toMatch(/Retail feature gate is off/)
    })

    it("reports configured, never online, without provider evidence", () => {
      const result = projectShift4TerminalReadiness(BASE_PROJECTION)
      expect(result.state).toBe("configured")
      expect(result.ready).toBe(false)
      expect(result.reason).toMatch(/connectivity has not been verified/i)
    })

    it("reports offline only when a status operation proved it", () => {
      const result = projectShift4TerminalReadiness({
        ...BASE_PROJECTION,
        connectivity: evidence("offline"),
      })
      expect(result.state).toBe("offline")
    })

    it("reaches certification_required and enabled only with proven connectivity", () => {
      const online = { ...BASE_PROJECTION, connectivity: evidence("online") }

      expect(projectShift4TerminalReadiness(online).state).toBe("certification_required")
      expect(projectShift4TerminalReadiness({ ...online, certified: true }).state).toBe("blocked")

      const enabled = projectShift4TerminalReadiness({
        ...online,
        certified: true,
        productionAllowed: true,
      })
      expect(enabled.state).toBe("enabled")
      expect(enabled.ready).toBe(true)
    })

    it("never reports not_configured when the configuration could not be read", () => {
      // Not knowing is not the same as knowing there is nothing.
      const result = projectShift4TerminalReadiness({
        ...BASE_PROJECTION,
        configurationAvailable: false,
      })
      expect(result.state).toBe("blocked")
      expect(result.state).not.toBe("not_configured")
    })

    it("treats an unsourced online claim as not online", () => {
      // A claim without a documented provider operation behind it is refused,
      // so a future caller cannot fabricate connectivity by setting a string.
      expect(isShift4TerminalOnline(evidence("online", "pinetree_local_configuration"))).toBe(false)
      expect(isShift4TerminalOnline(evidence("online", "none"))).toBe(false)
      expect(isShift4TerminalOnline(evidence("online"))).toBe(true)
    })

    it("cannot produce online evidence today and contacts nothing to try", async () => {
      const result = await resolveShift4TerminalConnectivity("merchant-1")

      expect(result.state).toBe("unverified")
      expect(result.source).toBe("none")
      expect(result.observedAt).toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  /* ════════════════════════════════════════════════════════════════════════
     3. TERMINAL CONFIGURATION
     ════════════════════════════════════════════════════════════════════════ */

  describe("terminal configuration", () => {
    type Reader = Record<string, unknown>

    /** Mount the terminal database services with an in-memory store. */
    function mountReaders(initial: Reader[]) {
      const calls = { upsert: 0, replace: 0, list: [] as string[] }
      const rows = [...initial]

      vi.doMock("@/database/merchantTerminalReaders", () => ({
        listMerchantTerminalReaders: async (_merchantId: string, provider: string) => {
          calls.list.push(provider)
          return rows.filter((row) => row.provider === provider)
        },
        upsertMerchantTerminalReader: async (input: Record<string, unknown>) => {
          calls.upsert += 1
          const row = {
            id: `reader-${rows.length + 1}`,
            merchant_id: input.merchantId,
            provider: input.provider,
            provider_reader_id: input.providerReaderId,
            terminal_location_id: input.terminalLocationId ?? null,
            label: input.label,
            device_type: input.deviceType,
            serial_number: input.serialNumber ?? null,
            status: input.status,
            simulated: input.simulated,
            is_default: false,
            active_payment_id: null,
            last_seen_at: null,
          }
          rows.push(row)
          return row
        },
        replaceMerchantTerminalReaderById: async (input: Record<string, unknown>) => {
          calls.replace += 1
          const row = rows.find(
            (candidate) => candidate.id === input.readerId && candidate.provider === input.provider
          )
          if (!row) throw new Error("Reader not found for this merchant and provider")
          Object.assign(row, {
            provider_reader_id: input.providerReaderId,
            terminal_location_id: input.terminalLocationId,
            label: input.label,
            device_type: input.deviceType,
            serial_number: input.serialNumber,
            status: input.status,
          })
          return row
        },
      }))

      vi.doMock("@/database/merchantTerminalLocations", () => ({
        getMerchantTerminalLocationById: async (_merchantId: string, id: string) =>
          id === "11111111-1111-4111-8111-111111111111"
            ? { id, merchant_id: "merchant-1", provider: "shift4", provider_location_id: "loc-1", display_name: "Front", address: {}, status: "active" }
            : null,
      }))

      return { calls, rows }
    }

    const VALID = {
      intent: "create" as const,
      terminalId: "TERM-0001",
      model: "PAX A920",
      serialNumber: "SN12345678",
      locationId: null,
    }

    it("rejects every unsupported and server-derived field", async () => {
      const { normalizeShift4TerminalInput } = await import("@/engine/shift4/retailTerminal")

      for (const field of ["merchantId", "provider", "environment", "channel", "simulated", "status"]) {
        expect(() =>
          normalizeShift4TerminalInput({ ...VALID, serialNumber: "SN1", [field]: "x" })
        ).toThrow(/Unsupported field/)
      }
    })

    it("requires an explicit create or replace intent", async () => {
      const { normalizeShift4TerminalInput } = await import("@/engine/shift4/retailTerminal")

      expect(() => normalizeShift4TerminalInput({ ...VALID, intent: "upsert" })).toThrow(/intent/)
      expect(() => normalizeShift4TerminalInput({ terminalId: "T1", model: "PAX" })).toThrow(/intent/)
      expect(normalizeShift4TerminalInput({ ...VALID }).intent).toBe("create")
    })

    it("validates the required terminal fields", async () => {
      const { normalizeShift4TerminalInput } = await import("@/engine/shift4/retailTerminal")

      expect(() => normalizeShift4TerminalInput({ ...VALID, terminalId: "" })).toThrow(/terminalId/)
      expect(() => normalizeShift4TerminalInput({ ...VALID, terminalId: "bad id!" })).toThrow(/terminalId/)
      expect(() => normalizeShift4TerminalInput({ ...VALID, model: "" })).toThrow(/model/)
      expect(() => normalizeShift4TerminalInput({ ...VALID, serialNumber: "not a serial!" })).toThrow(/serialNumber/)
      expect(() => normalizeShift4TerminalInput({ ...VALID, locationId: "not-a-uuid" })).toThrow(/locationId/)
    })

    it("masks the serial number and never returns it in full", async () => {
      const { maskSerialNumber } = await import("@/engine/shift4/retailTerminal")

      const masked = maskSerialNumber("SN12345678")
      expect(masked).toMatch(/5678$/)
      expect(masked).not.toContain("SN12")
      expect(maskSerialNumber("AB")).toBe("••")
      expect(maskSerialNumber(null)).toBeNull()
    })

    it("creates one Shift4 reader and never marks it simulated or ready", async () => {
      const { calls, rows } = mountReaders([])
      const { configureShift4RetailTerminal } = await import("@/engine/shift4/retailTerminal")

      const view = await configureShift4RetailTerminal("merchant-1", VALID)

      expect(calls.upsert).toBe(1)
      expect(calls.replace).toBe(0)
      expect(calls.list.every((provider) => provider === "shift4")).toBe(true)
      expect(rows).toHaveLength(1)
      expect(rows[0].provider).toBe("shift4")
      expect(rows[0].simulated).toBe(false)
      // The status that previously read back as "online".
      expect(rows[0].status).toBe("configured")
      expect(["online", "active", "connected", "ready"]).not.toContain(rows[0].status)

      expect(view.configured).toBe(true)
      expect(view.channel).toBe("retail")
      expect(view.environment).toBe("test")
      expect(view.connectivityState).toBe("unverified")
      expect(view.readinessState).toBe("disabled")
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("creates a distinct second terminal without changing the existing reader", async () => {
      const { calls, rows } = mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN1", terminal_location_id: null, status: "configured" },
      ])
      const { configureShift4RetailTerminal } = await import("@/engine/shift4/retailTerminal")

      const view = await configureShift4RetailTerminal("merchant-1", { ...VALID, terminalId: "TERM-0002" })
      await expect(
        configureShift4RetailTerminal("merchant-1", { ...VALID, terminalId: "TERM-0002" })
      ).rejects.toMatchObject({ code: "terminal_already_configured" })

      expect(view.terminalId).toBe("TERM-0002")
      expect(rows).toHaveLength(2)
      expect(rows[0].provider_reader_id).toBe("TERM-0001")
      expect(calls.upsert).toBe(1)
      expect(calls.replace).toBe(0)
    })

    it("edits in place on an explicit replace, keeping one row", async () => {
      const { calls, rows } = mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN1", terminal_location_id: null, status: "configured" },
      ])
      const { configureShift4RetailTerminal } = await import("@/engine/shift4/retailTerminal")

      const view = await configureShift4RetailTerminal("merchant-1", {
        ...VALID,
        intent: "replace",
        terminalId: "TERM-0002",
      })

      // Changing the terminal ID is an edit, not a new device.
      expect(calls.replace).toBe(1)
      expect(calls.upsert).toBe(0)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe("reader-1")
      expect(view.terminalId).toBe("TERM-0002")
    })

    it("refuses a replace when nothing is configured yet", async () => {
      mountReaders([])
      const { configureShift4RetailTerminal } = await import("@/engine/shift4/retailTerminal")

      await expect(
        configureShift4RetailTerminal("merchant-1", { ...VALID, intent: "replace" })
      ).rejects.toMatchObject({ code: "terminal_not_configured" })
    })

    it("leaves readers belonging to other providers untouched", async () => {
      const { rows } = mountReaders([
        { id: "stripe-1", provider: "stripe", provider_reader_id: "tmr_1", device_type: "WisePOS", serial_number: "S1", terminal_location_id: null, status: "online" },
        { id: "fluidpay-1", provider: "fluidpay", provider_reader_id: "fp_1", device_type: "PAX", serial_number: "F1", terminal_location_id: null, status: "online" },
      ])
      const { configureShift4RetailTerminal, getShift4RetailTerminal } = await import(
        "@/engine/shift4/retailTerminal"
      )

      // Neither other-provider reader counts as configured, and neither is
      // rewritten by a create.
      expect((await getShift4RetailTerminal("merchant-1")).configured).toBe(false)
      await configureShift4RetailTerminal("merchant-1", VALID)

      expect(rows.find((row) => row.id === "stripe-1")).toMatchObject({
        provider_reader_id: "tmr_1",
        status: "online",
      })
      expect(rows.find((row) => row.id === "fluidpay-1")).toMatchObject({
        provider_reader_id: "fp_1",
        status: "online",
      })
    })

    it("rejects a terminal location that is not this merchant's Shift4 location", async () => {
      mountReaders([])
      const { configureShift4RetailTerminal } = await import("@/engine/shift4/retailTerminal")

      await expect(
        configureShift4RetailTerminal("merchant-1", {
          ...VALID,
          locationId: "22222222-2222-4222-8222-222222222222",
        })
      ).rejects.toMatchObject({ code: "location_not_found" })
    })
  })

  /* ════════════════════════════════════════════════════════════════════════
     4. TERMINAL VERIFICATION
     ════════════════════════════════════════════════════════════════════════ */

  describe("terminal verification", () => {
    function mountReaders(rows: Record<string, unknown>[]) {
      const writes = { upsert: 0, replace: 0 }
      vi.doMock("@/database/merchantTerminalReaders", () => ({
        listMerchantTerminalReaders: async (_merchantId: string, provider: string) =>
          rows.filter((row) => row.provider === provider),
        upsertMerchantTerminalReader: async () => {
          writes.upsert += 1
          throw new Error("Verification must not write")
        },
        replaceMerchantTerminalReaderById: async () => {
          writes.replace += 1
          throw new Error("Verification must not write")
        },
      }))
      vi.doMock("@/database/merchantTerminalLocations", () => ({
        getMerchantTerminalLocationById: async () => null,
      }))
      return writes
    }

    it("performs no provider call and says so explicitly", async () => {
      mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN12345678", terminal_location_id: null, status: "configured" },
      ])
      const { verifyShift4RetailTerminalReadiness } = await import("@/engine/shift4/retailTerminal")

      const result = await verifyShift4RetailTerminalReadiness("merchant-1")

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.providerCallPerformed).toBe(false)
      expect(result.evidenceSource).toBe("pinetree_local_configuration")
      expect(result.connectivityState).toBe("unverified")
      expect(result.connectivityState).not.toBe("online")
    })

    it("writes nothing", async () => {
      const writes = mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN1", terminal_location_id: null, status: "configured" },
      ])
      const { verifyShift4RetailTerminalReadiness } = await import("@/engine/shift4/retailTerminal")

      await verifyShift4RetailTerminalReadiness("merchant-1")
      expect(writes).toEqual({ upsert: 0, replace: 0 })
    })

    it("states what external information is still required", async () => {
      mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN1", terminal_location_id: null, status: "configured" },
      ])
      const { verifyShift4RetailTerminalReadiness } = await import("@/engine/shift4/retailTerminal")

      const result = await verifyShift4RetailTerminalReadiness("merchant-1")

      expect(result.awaiting).toContain("shift4_device_assignment")
      expect(result.awaiting).toContain("shift4_terminal_status_operation_documentation")
      expect(result.awaiting).toContain("shift4_certification")
      expect(result.proves).toBe("local_terminal_configuration_present")
      expect(result.doesNotProve).toContain("provider_connectivity")
      expect(result.doesNotProve).toContain("card_processing_approval")
    })

    it("reports honestly when nothing is configured", async () => {
      mountReaders([])
      const { verifyShift4RetailTerminalReadiness } = await import("@/engine/shift4/retailTerminal")

      const result = await verifyShift4RetailTerminalReadiness("merchant-1")

      expect(result.configured).toBe(false)
      expect(result.readinessState).toBe("not_configured")
      expect(result.proves).toBe("no_local_terminal_configuration")
      expect(result.awaiting).toContain("pinetree_terminal_configuration")
    })

    it("returns a masked serial rather than the stored value", async () => {
      mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN12345678", terminal_location_id: null, status: "configured" },
      ])
      const { verifyShift4RetailTerminalReadiness } = await import("@/engine/shift4/retailTerminal")

      const serialized = JSON.stringify(await verifyShift4RetailTerminalReadiness("merchant-1"))
      expect(serialized).not.toContain("SN12345678")
      expect(serialized).toContain("5678")
    })

    it("never enables Retail processing or marks card processing verified", async () => {
      mountReaders([
        { id: "reader-1", provider: "shift4", provider_reader_id: "TERM-0001", device_type: "PAX", serial_number: "SN1", terminal_location_id: null, status: "configured" },
      ])
      const { verifyShift4RetailTerminalReadiness } = await import("@/engine/shift4/retailTerminal")

      const result = await verifyShift4RetailTerminalReadiness("merchant-1")

      expect(result.retailProcessingEnabled).toBe(false)
      expect(result.readinessState).toBe("disabled")
      expect(result.readinessState).not.toBe("enabled")
    })
  })

  /* ════════════════════════════════════════════════════════════════════════
     5. PLACEMENT, AUTHORIZATION, AND SECRECY (source contracts)
     ════════════════════════════════════════════════════════════════════════ */

  describe("placement and authorization", () => {
    it("mounts the terminal card only inside the Admin Shift4 section", () => {
      const section = source(ADMIN_SECTION)

      expect(section).toContain("Shift4RetailTerminalCard")
      expect(section).toContain("Shift4 Sandbox Operations")
      // Unauthorized callers render nothing at all.
      expect(section).toContain("if (authorized !== true) return null")

      // Ordered after the connection verification card, before readiness.
      // Sliced to the rendered markup so an import line cannot satisfy this.
      const markup = section.slice(section.indexOf("<section"))
      const order = [
        "<Shift4RetailVerificationCard />",
        "<Shift4RetailTerminalCard />",
        "<Shift4RestReadinessCard",
      ]
      const positions = order.map((needle) => markup.indexOf(needle))
      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })

    it("keeps development readiness explanatory and inside the operator-only section", () => {
      const section = source(ADMIN_SECTION)
      const card = source(DEVELOPMENT_CARD)

      expect(section).toContain("Shift4RetailDevelopmentReadinessCard")
      expect(card).toContain("Shift4 Retail Development Readiness")
      expect(card).toContain("Awaiting hardware")
      expect(card).toContain("Blocked by documentation")
      expect(card).toContain("does not change Retail, certification, or production eligibility")
      expect(card).not.toMatch(/fetch\(|accessToken|clientGuid|SHIFT4_OPERATOR_EMAIL/)
    })

    it("adds nothing to the merchant Providers page", () => {
      const providers = source(PROVIDERS_PAGE)

      expect(providers).not.toContain("Shift4RetailTerminalCard")
      expect(providers).not.toContain("retail-terminal")
      expect(providers).not.toContain("Verify Shift4 Terminal Readiness")
    })

    it("requires the Shift4 operator on every terminal route", () => {
      for (const route of [TERMINAL_ROUTE, VERIFY_ROUTE]) {
        const routeSource = source(route)
        expect(routeSource, route).toContain("requireShift4OperatorFromRequest")
        // No merchant-level or plain-admin fallback exists.
        expect(codeOnly(routeSource), route).not.toMatch(
          /requireMerchantIdFromRequest|requireAdminFromRequest/
        )
      }
    })

    it("authorizes before reading the body on every route handler", () => {
      for (const route of [TERMINAL_ROUTE, VERIFY_ROUTE]) {
        const code = codeOnly(source(route))
        for (const handler of code.split(/export async function /).slice(1)) {
          const authorize = handler.indexOf("requireShift4OperatorFromRequest")
          const body = handler.search(/readBody|assertNoCallerInput|request\.text\(\)/)
          expect(authorize, route).toBeGreaterThan(-1)
          if (body > -1) expect(authorize, route).toBeLessThan(body)
        }
      }
    })

    it("never compares an operator email in client code", () => {
      for (const path of [CARD, CLIENT, ADMIN_SECTION]) {
        expect(source(path), path).not.toContain("SHIFT4_OPERATOR_EMAIL")
        expect(source(path), path).not.toMatch(/NEXT_PUBLIC_SHIFT4/)
      }
      // The authorization helper never returns the configured address.
      expect(source("lib/api/shift4OperatorAuth.ts")).toContain("authorized: boolean")
    })

    it("rejects a body naming merchant, provider, environment, or channel", () => {
      const routeSource = source(TERMINAL_ROUTE)
      for (const field of ["merchantId", "provider", "environment", "channel", "accessToken", "clientGuid"]) {
        expect(routeSource, field).toContain(`"${field}"`)
      }
      expect(routeSource).toContain("caller_input_not_accepted")
      expect(source(VERIFY_ROUTE)).toContain("caller_input_not_accepted")
    })

    it("fixes provider, channel, and environment server-side", async () => {
      const engine = source(ENGINE)

      expect(engine).toContain('SHIFT4_TERMINAL_PROVIDER = "shift4"')
      expect(engine).toContain('SHIFT4_TERMINAL_CHANNEL = "retail"')
      // Environment is read from server configuration, never from a parameter.
      expect(engine).toContain("getShift4RestConfig().environment")

      /**
       * The accepted-input list is the real contract: a field absent from it
       * cannot be supplied, because `normalizeShift4TerminalInput` rejects every
       * key it does not name.
       */
      const { SHIFT4_TERMINAL_INPUT_FIELDS, normalizeShift4TerminalInput } = await import(
        "@/engine/shift4/retailTerminal"
      )
      for (const serverDerived of ["merchantId", "provider", "environment", "channel"]) {
        expect(SHIFT4_TERMINAL_INPUT_FIELDS, serverDerived).not.toContain(serverDerived)
      }

      const normalized = normalizeShift4TerminalInput({
        intent: "create",
        terminalId: "TERM-0001",
        model: "PAX A920",
      })
      expect(Object.keys(normalized).sort()).toEqual([
        "intent",
        "locationId",
        "model",
        "readerId",
        "serialNumber",
        "terminalId",
      ])
    })

    it("sets no-store on every terminal response", () => {
      for (const route of [TERMINAL_ROUTE, VERIFY_ROUTE]) {
        expect(source(route), route).toContain("no-store")
        expect(source(route), route).toContain("noStore(")
      }
    })
  })

  describe("response construction and secrecy", () => {
    it("returns exactly the safe field set from both terminal routes", () => {
      for (const route of [TERMINAL_ROUTE, VERIFY_ROUTE]) {
        const routeSource = source(route)
        for (const field of SAFE_TERMINAL_FIELDS) {
          expect(routeSource, `${route}:${field}`).toContain(`${field}:`)
        }
      }
    })

    it("builds responses field by field rather than spreading a row", () => {
      for (const path of [ENGINE, TERMINAL_ROUTE, VERIFY_ROUTE]) {
        const code = codeOnly(source(path))
        expect(code, path).not.toMatch(/\.\.\.(row|reader|record|data|view|verification)\b/)
      }
    })

    it("never returns or logs a credential, token, or Client GUID", () => {
      for (const path of [ENGINE, TERMINAL_ROUTE, VERIFY_ROUTE, CLIENT, CARD]) {
        const code = codeOnly(source(path))
        expect(code, path).not.toMatch(/accessToken\s*[:=]\s*[^,\s)]/)
        expect(code, path).not.toMatch(/clientGuid\s*[:=]\s*[^,\s)]/)
        expect(code, path).not.toMatch(/authToken\s*[:=]\s*[^,\s)]/)
        expect(code, path).not.toContain("getShift4RestAccessToken")
        expect(code, path).not.toContain("decryptShift4")
      }
    })

    it("never exposes the raw serial number to the browser", () => {
      // Only the masked value is projected, and the form never prefills it.
      expect(codeOnly(source(ENGINE))).toContain("maskSerialNumber(input.reader.serial_number)")
      expect(codeOnly(source(ENGINE))).not.toMatch(/serialNumber:\s*\w+\.serial_number/)
      expect(source(CLIENT)).not.toContain("serial_number")
    })

    it("keeps every logged field on the Shift4 safe allowlist", async () => {
      const { safeShift4LogFields } = await import("@/engine/shift4/observability")

      const safe = safeShift4LogFields({
        merchantId: "merchant-1",
        channel: "retail",
        environment: "test",
        correlationId: "correlation-1",
        terminalReaderId: "reader-1",
        readinessState: "configured",
        evidenceSource: "pinetree_local_configuration",
        verifiedAt: "2026-08-03T00:00:00.000Z",
        // None of these may survive.
        accessToken: "SECRET",
        serialNumber: "SN12345678",
        terminalId: "TERM-0001",
      })

      expect(Object.keys(safe).sort()).toEqual([
        "channel",
        "correlationId",
        "environment",
        "evidenceSource",
        "merchantId",
        "readinessState",
        "terminalReaderId",
        "verifiedAt",
      ])
    })
  })

  /* ════════════════════════════════════════════════════════════════════════
     6. NO PAYMENT, NO EXCHANGE, NO RETRY, NO SQL
     ════════════════════════════════════════════════════════════════════════ */

  describe("forbidden operations", () => {
    it("names no payment operation and performs no Access Token Exchange", () => {
      const code = codeOnly(source(ENGINE))

      /**
       * Shift4 operation identifiers are string literals, so a quoted
       * occurrence is what would matter. Matching bare substrings instead would
       * flag ordinary TypeScript — `: void` is a return type, not the Void
       * operation.
       */
      for (const operation of [
        "authorization",
        "manual_authorization",
        "capture",
        "sale",
        "refund",
        "void",
        "access_token_exchange",
      ]) {
        expect(code, operation).not.toMatch(new RegExp(`["'\`]${operation}["'\`]`))
      }

      // Nothing that could execute one is imported or called.
      for (const identifier of [
        "exchangeAccessToken",
        "saveShift4RestConnection",
        "clearShift4RestCredential",
        "getMerchantInformation",
        "executeShift4RetailInteraction",
        "Shift4CommerceEngineClient",
      ]) {
        expect(code, identifier).not.toContain(identifier)
      }
    })

    it("issues no HTTP request of its own from the Engine", () => {
      const code = codeOnly(source(ENGINE))
      expect(code).not.toContain("shift4RestRequest")
      expect(code).not.toMatch(/\bfetch\s*\(/)
      expect(code).not.toMatch(/https?:\/\//)
    })

    it("executes no SQL and needs no migration", () => {
      const code = codeOnly(source(ENGINE))

      // Every write goes through the existing terminal service functions.
      expect(code).not.toMatch(/\.from\(|\bselect\(|\brpc\(|CREATE TABLE|ALTER TABLE/i)
      expect(code).toContain("listMerchantTerminalReaders")
      expect(code).toContain("upsertMerchantTerminalReader")
      expect(code).toContain("replaceMerchantTerminalReaderById")
    })

    it("writes no feature flag anywhere on the terminal path", () => {
      for (const path of [ENGINE, TERMINAL_ROUTE, VERIFY_ROUTE]) {
        const code = codeOnly(source(path))
        expect(code, path).not.toMatch(/process\.env\.SHIFT4_\w+\s*=/)
        expect(code, path).not.toContain("card_processing_verified")
        expect(code, path).not.toContain("cardProcessingVerified")
      }
    })

    it("dispatches at most one request per click and never retries", () => {
      const code = codeOnly(source(CLIENT))

      expect(code).not.toMatch(/\bretry\b/i)
      expect(code).not.toMatch(/\bwhile\s*\(/)
      expect(code).not.toMatch(/\bfor\s*\(/)
      expect(code).not.toMatch(/setInterval|setTimeout\([^)]*\)\s*=>\s*\w+\(/)
      // Exactly one fetch call site exists, shared by all three operations.
      expect(code.match(/fetchImpl\(/g) ?? []).toHaveLength(1)
    })

    it("runs no verification on page load and guards double submission", () => {
      const code = codeOnly(source(CARD))

      // The only effect performs the read-only GET; verification is not in it.
      const effects = code.match(/useEffect\([\s\S]*?\n  \}, \[[^\]]*\]\)/g) ?? []
      expect(effects).toHaveLength(1)
      expect(effects[0]).toContain("loadRetailTerminal")
      expect(effects[0]).not.toContain("submitRetailTerminalVerification")

      // Synchronous guards, not state, so a fast double click cannot pass.
      expect(code).toContain("if (submitRef.current) return")
      expect(code).toContain("if (verifyRef.current) return")
      expect(code).not.toContain("setInterval")
    })

    it("never renders Online without provider evidence", () => {
      const card = source(CARD)

      // "online" is a key in the label maps only; nothing derives it locally.
      expect(codeOnly(card)).not.toMatch(/connectivityState\s*===\s*"online"/)
      expect(card).toContain("providerCallPerformed")
      expect(card).toContain("Provider connectivity")
    })

    it("keeps the operator action explicitly labelled", () => {
      expect(source(CARD)).toContain("Verify Shift4 Terminal Readiness")
    })
  })
})
