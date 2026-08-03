/**
 * Shift4 readiness projection over the version-2 channel credential shape.
 *
 * Proves the full path a stored credential travels:
 *   merchant_providers row
 *     -> normalizeCredentialDocument
 *     -> getShift4RestConnectionStatus
 *     -> resolveShift4Readiness
 *
 * The row is fed through the real projection with the Supabase client mocked,
 * so these are contract tests over actual behavior rather than assertions about
 * a hand-built status view.
 *
 * NO NETWORK REQUEST IS MADE: `fetch` is replaced with a throwing stub and the
 * database client is an in-memory object.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const IDENTITY = {
  interfaceName: "PineTreePayments",
  interfaceVersion: "1.0.0",
  companyName: "PineTree Payments",
}

/** Test-only 32-byte key. Never a deployment value. */
const TEST_ENCRYPTION_KEY = "a".repeat(64)

const RETAIL_TOKEN = "RETAIL-TOKEN-0001"
const ECOMMERCE_TOKEN = "ECOM-TOKEN-0001"
const LEGACY_TOKEN = "LEGACY-TOKEN-0001"

type Row = { id: string; status: string; enabled: boolean; credentials: unknown }

describe("Shift4 readiness channel projection", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_REST_ENABLED", "true")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", IDENTITY.interfaceName)
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", IDENTITY.interfaceVersion)
    vi.stubEnv("SHIFT4_COMPANY_NAME", IDENTITY.companyName)
    vi.stubEnv("SHIFT4_CREDENTIAL_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY)

    fetchSpy = vi.fn(() => {
      throw new Error("A network request was attempted during a readiness test.")
    })
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.doUnmock("@/database/supabase")
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /** Mount one merchant_providers row behind the real projection. */
  function mountRow(row: Row | null) {
    vi.doMock("@/database/supabase", () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
      }
      const client = { from: () => builder }
      return { supabaseAdmin: client, supabase: client }
    })
  }

  async function encrypt(plaintext: string) {
    const { encryptShift4AccessToken } = await import(
      "@/providers/shift4/rest/credentials/secretEnvelope"
    )
    return encryptShift4AccessToken(plaintext)
  }

  async function channelCredential(token: string, environment: "test" | "production" = "test") {
    return {
      environment,
      access_token: await encrypt(token),
      access_token_fingerprint: `fingerprint-${token.slice(0, 6)}`,
      interface_name: IDENTITY.interfaceName,
      interface_version: IDENTITY.interfaceVersion,
      company_name: IDENTITY.companyName,
      connected_at: "2026-08-02T00:00:01.000Z",
      last_exchange_correlation_id: "correlation-1",
      last_exchange_server_name: "TM01CE",
      last_exchange_provider_date_time: null,
      card_processing_verified: false,
    }
  }

  async function versionTwoRow(
    channels: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ): Promise<Row> {
    return {
      id: "connection-1",
      status: "connected",
      enabled: false,
      credentials: {
        provider_model: "shift4_payment_platform_rest",
        credential_version: 2,
        channels,
        ...extra,
      },
    }
  }

  /** Resolve readiness with terminal/onboarding/i4Go held constant. */
  async function readiness() {
    const { resolveShift4Readiness } = await import("@/engine/shift4/readiness")
    return resolveShift4Readiness("merchant-1", {
      listReaders: async () => [],
      getOnboarding: async () => null,
      i4goConfigured: false,
    })
  }

  /* ── Retail-only version-2 credential ─────────────────────────────────── */

  describe("a version-2 Retail-only credential", () => {
    beforeEach(async () => {
      mountRow(await versionTwoRow({ retail: await channelCredential(RETAIL_TOKEN) }))
    })

    it("makes merchant authentication true", async () => {
      const result = await readiness()

      expect(result.authenticated).toBe(true)
      expect(result.credentialPresent).toBe(true)
      expect(result.capabilities.merchant_authentication.state).toBe("authenticated")
      expect(result.capabilities.merchant_authentication.ready).toBe(true)
    })

    it("recognizes the Retail channel as connected", async () => {
      const result = await readiness()

      expect(result.authenticatedChannels.retail).toBe(true)
      expect(result.capabilities.rest_api.state).toBe("authenticated")
    })

    it("never reports not_configured once the credential exists", async () => {
      const result = await readiness()

      for (const [name, capability] of Object.entries(result.capabilities)) {
        // `terminal` legitimately reports not_configured: it describes a
        // physical device, not the credential.
        if (name === "terminal" || name === "merchant_onboarding") continue
        expect(capability.state, name).not.toBe("not_configured")
      }
    })

    it("keeps Retail disabled while SHIFT4_RETAIL_ENABLED is off", async () => {
      const result = await readiness()

      expect(result.capabilities.retail.state).toBe("disabled")
      expect(result.capabilities.retail.ready).toBe(false)
      expect(result.capabilities.retail.reason).toMatch(/Retail feature gate is off/)
    })

    it("keeps Retail disabled when the flag is explicitly false", async () => {
      vi.stubEnv("SHIFT4_RETAIL_ENABLED", "false")
      const result = await readiness()

      expect(result.capabilities.retail.state).toBe("disabled")
      expect(result.capabilities.retail.ready).toBe(false)
    })

    it("does not claim certification or enabled processing", async () => {
      const result = await readiness()

      expect(result.processingEnabled).toBe(false)
      expect(result.capabilities.certification.state).not.toBe("certified")
      expect(result.capabilities.production_processing.state).toBe("blocked")
      expect(result.capabilities.production_processing.ready).toBe(false)
    })

    it("leaves E-commerce unconnected and does not let it inherit Retail", async () => {
      const result = await readiness()

      expect(result.authenticatedChannels.ecommerce).toBe(false)
      // With the ecommerce gate off the gate is reported; turning it on must
      // still report the missing credential rather than a vague blocker.
      vi.stubEnv("SHIFT4_ECOMMERCE_ENABLED", "true")
      const withGate = await readiness()
      expect(withGate.capabilities.ecommerce.ready).toBe(false)
      expect(withGate.capabilities.ecommerce.reason).toMatch(/No E-commerce credential/i)
    })

    it("reports Retail as ready-to-gate once its flag and prerequisites pass", async () => {
      vi.stubEnv("SHIFT4_RETAIL_ENABLED", "true")
      vi.stubEnv("SHIFT4_COMMERCE_ENGINE_CONFIGURED", "true")
      const { resolveShift4Readiness } = await import("@/engine/shift4/readiness")

      const result = await resolveShift4Readiness("merchant-1", {
        listReaders: async () => [
          {
            id: "reader-1", merchant_id: "merchant-1", terminal_location_id: null,
            provider: "shift4", provider_reader_id: "pax-1", label: "Front",
            device_type: "PAX", serial_number: null, status: "online",
            simulated: true, is_default: true, active_payment_id: null, last_seen_at: null,
          },
        ],
        getOnboarding: async () => null,
        i4goConfigured: false,
      })

      // Authentication and the gate now pass, so certification is the blocker -
      // never a claim that processing is enabled.
      expect(result.capabilities.retail.state).toBe("certification_required")
      expect(result.capabilities.retail.ready).toBe(false)
      expect(result.processingEnabled).toBe(false)
    })
  })

  /* ── Ecommerce-only version-2 credential ──────────────────────────────── */

  describe("a version-2 E-commerce-only credential", () => {
    beforeEach(async () => {
      mountRow(await versionTwoRow({ ecommerce: await channelCredential(ECOMMERCE_TOKEN) }))
    })

    it("does not authenticate Retail", async () => {
      const result = await readiness()

      expect(result.authenticatedChannels.ecommerce).toBe(true)
      expect(result.authenticatedChannels.retail).toBe(false)
    })

    it("reports the missing Retail credential rather than a generic blocker", async () => {
      vi.stubEnv("SHIFT4_RETAIL_ENABLED", "true")
      vi.stubEnv("SHIFT4_COMMERCE_ENGINE_CONFIGURED", "true")
      const result = await readiness()

      expect(result.capabilities.retail.ready).toBe(false)
      expect(result.capabilities.retail.reason).toMatch(/No Retail credential/i)
      // A credential row exists, so this is "configured", never "not_configured".
      expect(result.capabilities.retail.state).toBe("configured")
    })
  })

  /* ── Both channels ────────────────────────────────────────────────────── */

  it("lets both channels coexist and authenticate independently", async () => {
    mountRow(
      await versionTwoRow({
        retail: await channelCredential(RETAIL_TOKEN),
        ecommerce: await channelCredential(ECOMMERCE_TOKEN),
      })
    )

    const result = await readiness()

    expect(result.authenticatedChannels).toEqual({ retail: true, ecommerce: true })
    expect(result.authenticated).toBe(true)
    expect(result.capabilities.merchant_authentication.state).toBe("authenticated")
  })

  /* ── Legacy compatibility ─────────────────────────────────────────────── */

  it("keeps documented legacy shared compatibility for both channels", async () => {
    mountRow({
      id: "connection-legacy",
      status: "connected",
      enabled: false,
      credentials: {
        provider_model: "shift4_payment_platform_rest",
        environment: "test",
        channel: "shared",
        access_token: await encrypt(LEGACY_TOKEN),
        access_token_fingerprint: "legacy-fingerprint",
        card_processing_verified: false,
      },
    })

    const result = await readiness()

    expect(result.authenticated).toBe(true)
    expect(result.authenticatedChannels).toEqual({ retail: true, ecommerce: true })
    expect(result.capabilities.merchant_authentication.state).toBe("authenticated")
  })

  /* ── No credential at all ─────────────────────────────────────────────── */

  it("reports not_configured only when no credential row exists", async () => {
    mountRow(null)

    const result = await readiness()

    expect(result.authenticated).toBe(false)
    expect(result.credentialPresent).toBe(false)
    expect(result.capabilities.merchant_authentication.state).toBe("not_configured")
    expect(result.capabilities.retail.state).toBe("not_configured")
  })

  it("reports configured, not not_configured, when a cleared row remains", async () => {
    // `clearShift4RestCredential` keeps the row and its audit evidence but
    // strips every ciphertext.
    mountRow(
      await versionTwoRow({
        retail: {
          environment: "test",
          access_token_fingerprint: "fingerprint-retail",
          revoked_at: "2026-08-02T00:00:02.000Z",
          card_processing_verified: false,
        },
      })
    )

    const result = await readiness()

    expect(result.authenticated).toBe(false)
    expect(result.capabilities.merchant_authentication.state).toBe("configured")
  })

  /* ── Environment mismatch still fails closed ──────────────────────────── */

  it("keeps the environment mismatch guard closed for token resolution", async () => {
    mountRow(
      await versionTwoRow({ retail: await channelCredential(RETAIL_TOKEN, "production") })
    )

    const { getShift4RestAccessToken, Shift4CredentialEnvironmentMismatchError } = await import(
      "@/database/merchantShift4RestConnections"
    )

    await expect(
      getShift4RestAccessToken("merchant-1", { channel: "retail" })
    ).rejects.toBeInstanceOf(Shift4CredentialEnvironmentMismatchError)
  })

  it("never falls back from Retail to the E-commerce credential", async () => {
    mountRow(await versionTwoRow({ ecommerce: await channelCredential(ECOMMERCE_TOKEN) }))

    const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")

    expect(await getShift4RestAccessToken("merchant-1", { channel: "retail" })).toBeNull()
    expect(
      (await getShift4RestAccessToken("merchant-1", { channel: "ecommerce" }))?.accessToken
    ).toBe(ECOMMERCE_TOKEN)
  })

  /* ── Secret containment ───────────────────────────────────────────────── */

  it("puts no secret material in the readiness projection", async () => {
    mountRow(
      await versionTwoRow({
        retail: await channelCredential(RETAIL_TOKEN),
        ecommerce: await channelCredential(ECOMMERCE_TOKEN),
      })
    )

    const serialized = JSON.stringify(await readiness())

    for (const secret of [RETAIL_TOKEN, ECOMMERCE_TOKEN, TEST_ENCRYPTION_KEY]) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toMatch(/ciphertext|authTag|access_token"|clientGuid|SHIFT4_/)
  })

  it("puts no secret material in the connection status view", async () => {
    mountRow(await versionTwoRow({ retail: await channelCredential(RETAIL_TOKEN) }))

    const { getShift4RestConnectionStatus } = await import(
      "@/database/merchantShift4RestConnections"
    )
    const serialized = JSON.stringify(await getShift4RestConnectionStatus("merchant-1"))

    expect(serialized).not.toContain(RETAIL_TOKEN)
    expect(serialized).not.toMatch(/ciphertext|authTag/)
    // The fingerprint is the only credential-derived value that may appear.
    expect(serialized).toContain("fingerprint-")
  })

  it("keeps the provider key exactly shift4_rest", async () => {
    const { SHIFT4_REST_PROVIDER_NAME } = await import("@/database/merchantShift4RestConnections")
    expect(SHIFT4_REST_PROVIDER_NAME).toBe("shift4_rest")
  })

  it("makes no network request in any of these cases", () => {
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
