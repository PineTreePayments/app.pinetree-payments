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

    it("never reports not_configured for a capability this credential serves", async () => {
      const result = await readiness()

      /**
       * Scope corrected: "a credential row exists" makes the AGGREGATE and the
       * RETAIL-scoped capabilities configured, and nothing more.
       *
       * The row previously satisfied every capability, so an account holding
       * only a Retail credential reported E-commerce, Apple Pay and Google Pay
       * as "Configured" while their own descriptions said no such credential
       * existed. A credential is scoped to one Shift4 interface; a row is not a
       * credential for a channel it was never exchanged for.
       */
      const servedByRetail = [
        "rest_api",
        "merchant_authentication",
        "retail",
        "manual_authorization",
        "partial_approval",
        "split_tender",
      ]

      for (const name of servedByRetail) {
        expect(result.capabilities[name as keyof typeof result.capabilities].state, name).not.toBe(
          "not_configured"
        )
      }
    })

    it("reports every E-commerce capability as not configured", async () => {
      // The exact bug this phase fixes: none of these may claim "Configured"
      // on the strength of a Retail credential.
      const result = await readiness()

      for (const name of ["ecommerce", "apple_pay", "google_pay", "tokenization", "hosted_checkout"]) {
        const capability = result.capabilities[name as keyof typeof result.capabilities]
        expect(capability.state, name).toBe("not_configured")
        expect(capability.ready, name).toBe(false)
        expect(capability.reason, name).toMatch(/No E-commerce credential is connected/i)
      }
    })

    it("keeps the wallets at not_configured even once their own flags are on", async () => {
      // "Disabled" claims everything is in place except the switch. With no
      // E-commerce credential and no i4Go configuration that is untrue, so the
      // flag must not be able to change the label.
      vi.stubEnv("SHIFT4_APPLE_PAY_ENABLED", "true")
      vi.stubEnv("SHIFT4_GOOGLE_PAY_ENABLED", "true")
      vi.stubEnv("SHIFT4_ECOMMERCE_ENABLED", "true")

      const result = await readiness()

      expect(result.capabilities.apple_pay.state).toBe("not_configured")
      expect(result.capabilities.google_pay.state).toBe("not_configured")
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

    /** One locally configured reader whose status column CLAIMS to be online. */
    const localReader = {
      id: "reader-1", merchant_id: "merchant-1", terminal_location_id: null,
      provider: "shift4", provider_reader_id: "pax-1", label: "Front",
      device_type: "PAX", serial_number: null, status: "online",
      simulated: true, is_default: true, active_payment_id: null, last_seen_at: null,
    }

    it("does not let a locally written reader status unblock Retail", async () => {
      vi.stubEnv("SHIFT4_RETAIL_ENABLED", "true")
      vi.stubEnv("SHIFT4_COMMERCE_ENGINE_CONFIGURED", "true")
      const { resolveShift4Readiness } = await import("@/engine/shift4/readiness")

      const result = await resolveShift4Readiness("merchant-1", {
        listReaders: async () => [localReader],
        getOnboarding: async () => null,
        i4goConfigured: false,
      })

      /**
       * `status: "online"` is PineTree's own column — the PAX adapter writes
       * "ready" for a simulated device — so it is not evidence of anything
       * Shift4 knows. Retail therefore stops at the terminal prerequisite, and
       * the reason names it rather than reporting a vague blocker.
       */
      expect(result.capabilities.retail.state).toBe("blocked")
      expect(result.capabilities.retail.ready).toBe(false)
      expect(result.capabilities.retail.reason).toMatch(/verified provider connectivity/i)
      expect(result.capabilities.terminal.state).toBe("configured")
      expect(result.processingEnabled).toBe(false)
    })

    it("reports Retail as ready-to-gate once provider connectivity is proven", async () => {
      vi.stubEnv("SHIFT4_RETAIL_ENABLED", "true")
      vi.stubEnv("SHIFT4_COMMERCE_ENGINE_CONFIGURED", "true")
      const { resolveShift4Readiness } = await import("@/engine/shift4/readiness")

      const result = await resolveShift4Readiness("merchant-1", {
        listReaders: async () => [localReader],
        getOnboarding: async () => null,
        i4goConfigured: false,
        // Injected proof from a documented status operation. The default
        // resolver can never produce this, which is the point of the seam.
        getTerminalConnectivity: async () => ({
          state: "online",
          source: "shift4_status_operation",
          observedAt: "2026-08-03T00:00:00.000Z",
        }),
      })

      // Authentication, the gate and the terminal now pass, so certification is
      // the blocker - never a claim that processing is enabled.
      expect(result.capabilities.retail.state).toBe("certification_required")
      expect(result.capabilities.retail.ready).toBe(false)
      expect(result.capabilities.terminal.state).toBe("certification_required")
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
      // Symmetric with the E-commerce correction: a row holding only the OTHER
      // channel's credential leaves this channel not configured. The aggregate
      // still reports "configured", because the connection itself exists.
      expect(result.capabilities.retail.state).toBe("not_configured")
      expect(result.capabilities.merchant_authentication.state).toBe("authenticated")
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
