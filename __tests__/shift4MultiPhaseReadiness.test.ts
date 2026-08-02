import { describe, expect, it } from "vitest"
import { assertShift4Capability, readShift4FeatureFlags, resolveShift4Readiness, Shift4ReadinessError, type Shift4FeatureFlags } from "@/engine/shift4/readiness"

const flags: Shift4FeatureFlags = Object.freeze({
  restApi: true, ecommerce: true, retail: true, certificationMode: true,
  manualAuthorization: true, partialApproval: true, splitTender: true,
  applePay: true, googlePay: true, production: false, onboardingRequired: false, commerceEngineConfigured: true,
})

const connection = {
  connectionId: "connection-1", status: "connected", enabled: true, connected: true,
  environment: "test" as const, accessTokenPresent: true, accessTokenFingerprint: "fingerprint",
  interfaceName: null, interfaceVersion: null, companyName: null, connectedAt: null,
  lastExchangeCorrelationId: null, lastExchangeServerName: null, channel: "shared" as const,
  cardProcessingVerified: true,
}

describe("Shift4 centralized readiness", () => {
  it("defaults every server feature gate closed", () => {
    expect(Object.values(readShift4FeatureFlags({}))).toEqual(Array(12).fill(false))
  })

  it("keeps authentication distinct from certification and processing", async () => {
    const readiness = await resolveShift4Readiness("merchant-1", {
      flags,
      getConnection: async () => ({ ...connection, cardProcessingVerified: false }),
      listReaders: async () => [],
      i4goConfigured: true,
    })
    expect(readiness.authenticated).toBe(true)
    expect(readiness.processingEnabled).toBe(false)
    expect(readiness.capabilities.ecommerce.state).toBe("certification_required")
    expect(() => assertShift4Capability(readiness, "ecommerce")).toThrow(Shift4ReadinessError)
  })

  it("requires a registered online terminal for retail but not ecommerce", async () => {
    const readiness = await resolveShift4Readiness("merchant-1", {
      flags,
      getConnection: async () => connection,
      listReaders: async () => [{ id: "reader-1", merchant_id: "merchant-1", terminal_location_id: null, provider: "shift4", provider_reader_id: "pax-1", label: "Front", device_type: "PAX", serial_number: null, status: "offline", simulated: true, is_default: true, active_payment_id: null, last_seen_at: null }],
      i4goConfigured: true,
    })
    expect(readiness.capabilities.ecommerce.ready).toBe(true)
    expect(readiness.capabilities.retail.ready).toBe(false)
    expect(readiness.capabilities.terminal.state).toBe("configured")
  })

  it("requires the separate production flag for a production credential", async () => {
    const readiness = await resolveShift4Readiness("merchant-1", {
      flags,
      getConnection: async () => ({ ...connection, environment: "production" }),
      listReaders: async () => [],
      i4goConfigured: true,
    })
    expect(readiness.processingEnabled).toBe(false)
    expect(readiness.capabilities.production_processing.state).toBe("blocked")
  })
})
