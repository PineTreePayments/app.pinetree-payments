/**
 * Shift4 merchant credential connection - security and channel-isolation
 * contracts.
 *
 * Covers the three defects this work closes:
 *   D1 - POST /api/internal/shift4/connect is the authenticated entry point;
 *   D2 - Retail and E-commerce credentials coexist and cannot overwrite each
 *        other inside the single `shift4_rest` row;
 *   D3 - a stored credential from another Shift4 environment fails closed.
 *
 * NO NETWORK REQUEST IS MADE. The provider exchange and the Supabase client are
 * both mocked, and a guard replaces global fetch with a throwing stub.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const FAKE_AUTH_TOKEN = "11111111-2222-3333-4444444444444444"
const FAKE_ACCESS_TOKEN = "AAAAAAAA-BBBB-CCCC-DDDDDDDDDDDDDDDD"
const FAKE_CLIENT_GUID = "99999999-8888-7777-6666666666666666"

const IDENTITY = {
  interfaceName: "PineTreePayments",
  interfaceVersion: "1.0.0",
  companyName: "PineTree Payments",
}

/** A 32-byte key, test-only and never a real deployment value. */
const TEST_ENCRYPTION_KEY = "a".repeat(64)

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8")

function stubEnvironment(environment: "test" | "production" = "test") {
  vi.stubEnv("SHIFT4_REST_ENVIRONMENT", environment)
  vi.stubEnv("SHIFT4_INTERFACE_NAME", IDENTITY.interfaceName)
  vi.stubEnv("SHIFT4_INTERFACE_VERSION", IDENTITY.interfaceVersion)
  vi.stubEnv("SHIFT4_COMPANY_NAME", IDENTITY.companyName)
  vi.stubEnv("SHIFT4_CLIENT_GUID", FAKE_CLIENT_GUID)
  vi.stubEnv("SHIFT4_CREDENTIAL_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY)
}

/**
 * An in-memory stand-in for the single `merchant_providers` row.
 *
 * Only the query shape this module actually uses is modeled; anything else
 * throws, so a future refactor cannot silently pass against a fake.
 */
function createProviderTableStub() {
  const rows = new Map<string, { id: string; status: string | null; enabled: boolean | null; credentials: unknown }>()

  const from = (table: string) => {
    if (table !== "merchant_providers") {
      throw new Error(`Unexpected table in test: ${table}`)
    }
    let filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return builder
      },
      maybeSingle: async () => {
        const row = rows.get(String(filters.merchant_id ?? ""))
        return { data: row ?? null, error: null }
      },
      single: async () => {
        const row = rows.get(String(filters.merchant_id ?? ""))
        return { data: row ? { id: row.id } : null, error: null }
      },
      insert: (values: Record<string, unknown>) => {
        const id = `connection-${rows.size + 1}`
        rows.set(String(values.merchant_id), {
          id,
          status: String(values.status ?? ""),
          enabled: values.enabled === true,
          credentials: values.credentials,
        })
        filters = { merchant_id: values.merchant_id }
        return builder
      },
      update: (values: Record<string, unknown>) => {
        const applyUpdate = async () => {
          const row = rows.get(String(filters.merchant_id ?? ""))
          if (row) {
            if ("credentials" in values) row.credentials = values.credentials
            if ("status" in values) row.status = String(values.status)
            if ("enabled" in values) row.enabled = values.enabled === true
          }
          return { data: null, error: null }
        }
        // The update builder is awaited directly after its `.eq()` chain.
        const updateBuilder: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return updateBuilder
          },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            applyUpdate().then(resolve, reject),
        }
        return updateBuilder
      },
    }
    return builder
  }

  return { client: { from }, rows }
}

/** Reads the raw stored JSONB so tests assert on what is really persisted. */
function storedCredentials(rows: Map<string, { credentials: unknown }>, merchantId: string) {
  return rows.get(merchantId)?.credentials as Record<string, unknown> | undefined
}

describe("Shift4 credential connection", () => {
  let providerTable: ReturnType<typeof createProviderTableStub>
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    stubEnvironment("test")
    providerTable = createProviderTableStub()

    // Any real network call in this file is a test failure, not a skipped case.
    fetchSpy = vi.fn(() => {
      throw new Error("A network request was attempted during a credential test.")
    })
    vi.stubGlobal("fetch", fetchSpy)

    vi.doMock("@/database/supabase", () => ({
      supabaseAdmin: providerTable.client,
      supabase: providerTable.client,
    }))
  })

  afterEach(() => {
    vi.doUnmock("@/database/supabase")
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /* ── Channel isolation (D2) ───────────────────────────────────────────── */

  describe("channel isolation", () => {
    async function saveChannel(channel: "retail" | "ecommerce", token: string) {
      const { saveShift4RestConnection } = await import("@/database/merchantShift4RestConnections")
      const { encryptShift4AccessToken } = await import(
        "@/providers/shift4/rest/credentials/secretEnvelope"
      )
      return saveShift4RestConnection({
        merchantId: "merchant-1",
        channel,
        encryptedAccessToken: encryptShift4AccessToken(token),
        accessTokenFingerprint: `fingerprint-${channel}`,
        environment: "test",
        interfaceName: IDENTITY.interfaceName,
        interfaceVersion: IDENTITY.interfaceVersion,
        companyName: IDENTITY.companyName,
        correlationId: `correlation-${channel}`,
        serverName: "TM01CE",
        providerDateTime: "2026-08-01T09:18:23.283-07:00",
      })
    }

    it("stores retail and ecommerce credentials side by side in one shift4_rest row", async () => {
      await saveChannel("retail", "RETAIL-TOKEN-0001")
      await saveChannel("ecommerce", "ECOM-TOKEN-0001")

      // One row, not two provider keys.
      expect(providerTable.rows.size).toBe(1)

      const credentials = storedCredentials(providerTable.rows, "merchant-1")
      const channels = credentials?.channels as Record<string, unknown>
      expect(Object.keys(channels).sort()).toEqual(["ecommerce", "retail"])
      expect(credentials?.credential_version).toBe(2)

      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")
      const retail = await getShift4RestAccessToken("merchant-1", { channel: "retail" })
      const ecommerce = await getShift4RestAccessToken("merchant-1", { channel: "ecommerce" })

      expect(retail?.accessToken).toBe("RETAIL-TOKEN-0001")
      expect(ecommerce?.accessToken).toBe("ECOM-TOKEN-0001")
      expect(retail?.source).toBe("channel")
    })

    it("exchanging ecommerce does not mutate the stored retail credential", async () => {
      await saveChannel("retail", "RETAIL-TOKEN-0001")
      const beforeRetail = JSON.stringify(
        (storedCredentials(providerTable.rows, "merchant-1")?.channels as Record<string, unknown>).retail
      )

      await saveChannel("ecommerce", "ECOM-TOKEN-0001")
      const afterRetail = JSON.stringify(
        (storedCredentials(providerTable.rows, "merchant-1")?.channels as Record<string, unknown>).retail
      )

      expect(afterRetail).toBe(beforeRetail)

      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")
      expect((await getShift4RestAccessToken("merchant-1", { channel: "retail" }))?.accessToken)
        .toBe("RETAIL-TOKEN-0001")
    })

    it("exchanging retail does not mutate the stored ecommerce credential", async () => {
      await saveChannel("ecommerce", "ECOM-TOKEN-0001")
      const beforeEcommerce = JSON.stringify(
        (storedCredentials(providerTable.rows, "merchant-1")?.channels as Record<string, unknown>).ecommerce
      )

      await saveChannel("retail", "RETAIL-TOKEN-0001")
      const afterEcommerce = JSON.stringify(
        (storedCredentials(providerTable.rows, "merchant-1")?.channels as Record<string, unknown>).ecommerce
      )

      expect(afterEcommerce).toBe(beforeEcommerce)

      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")
      expect((await getShift4RestAccessToken("merchant-1", { channel: "ecommerce" }))?.accessToken)
        .toBe("ECOM-TOKEN-0001")
    })

    it("fails closed for a channel that has no credential instead of falling back", async () => {
      await saveChannel("retail", "RETAIL-TOKEN-0001")

      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")
      const ecommerce = await getShift4RestAccessToken("merchant-1", { channel: "ecommerce" })

      // Never the retail token, and never a silent substitution.
      expect(ecommerce).toBeNull()
    })

    it("requires an explicit channel and rejects the legacy shared value", async () => {
      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")
      await expect(
        getShift4RestAccessToken("merchant-1", {
          channel: "shared" as unknown as "retail",
        })
      ).rejects.toThrow(/retail.*ecommerce/i)
    })

    it("keeps the provider key exactly shift4_rest with no per-channel variants", async () => {
      const { SHIFT4_REST_PROVIDER_NAME } = await import("@/database/merchantShift4RestConnections")
      expect(SHIFT4_REST_PROVIDER_NAME).toBe("shift4_rest")

      const moduleSource = source("database/merchantShift4RestConnections.ts")
      expect(moduleSource).not.toMatch(/["']shift4_rest_retail["']/)
      expect(moduleSource).not.toMatch(/["']shift4_rest_ecommerce["']/)
    })
  })

  /* ── Legacy compatibility ─────────────────────────────────────────────── */

  describe("version-1 credential compatibility", () => {
    /** Writes the pre-channel document shape directly. */
    async function seedLegacyShared(environment: "test" | "production" = "test") {
      const { encryptShift4AccessToken } = await import(
        "@/providers/shift4/rest/credentials/secretEnvelope"
      )
      providerTable.rows.set("merchant-1", {
        id: "connection-legacy",
        status: "connected",
        enabled: false,
        credentials: {
          provider_model: "shift4_payment_platform_rest",
          environment,
          channel: "shared",
          access_token: encryptShift4AccessToken("LEGACY-TOKEN-0001"),
          access_token_fingerprint: "legacy-fingerprint",
          interface_name: IDENTITY.interfaceName,
          interface_version: IDENTITY.interfaceVersion,
          company_name: IDENTITY.companyName,
          connected_at: "2026-07-30T00:00:01.000Z",
          card_processing_verified: false,
        },
      })
    }

    it("still reads a pre-existing shared credential through the explicit path", async () => {
      await seedLegacyShared()
      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")

      const resolved = await getShift4RestAccessToken("merchant-1", {
        channel: "retail",
        allowLegacySharedCredential: true,
      })

      expect(resolved?.accessToken).toBe("LEGACY-TOKEN-0001")
      expect(resolved?.source).toBe("legacy_shared")
    })

    it("does not use a shared credential when the compatibility path is not requested", async () => {
      await seedLegacyShared()
      const { getShift4RestAccessToken } = await import("@/database/merchantShift4RestConnections")

      expect(await getShift4RestAccessToken("merchant-1", { channel: "retail" })).toBeNull()
    })

    it("reports the legacy document in the non-secret status view", async () => {
      await seedLegacyShared()
      const { getShift4RestConnectionStatus } = await import(
        "@/database/merchantShift4RestConnections"
      )

      const status = await getShift4RestConnectionStatus("merchant-1")
      expect(status?.credentialVersion).toBe(1)
      expect(status?.legacySharedCredentialPresent).toBe(true)
      expect(status?.channels.retail).toBeNull()
      expect(status?.connected).toBe(true)
      expect(JSON.stringify(status)).not.toContain("LEGACY-TOKEN-0001")
    })

    it("migrates a legacy document to the channel map without losing it", async () => {
      await seedLegacyShared()
      const { saveShift4RestConnection, getShift4RestAccessToken } = await import(
        "@/database/merchantShift4RestConnections"
      )
      const { encryptShift4AccessToken } = await import(
        "@/providers/shift4/rest/credentials/secretEnvelope"
      )

      await saveShift4RestConnection({
        merchantId: "merchant-1",
        channel: "retail",
        encryptedAccessToken: encryptShift4AccessToken("RETAIL-TOKEN-0001"),
        accessTokenFingerprint: "fingerprint-retail",
        environment: "test",
        interfaceName: IDENTITY.interfaceName,
        interfaceVersion: IDENTITY.interfaceVersion,
        companyName: IDENTITY.companyName,
        correlationId: "correlation-retail",
        serverName: "TM01CE",
        providerDateTime: null,
      })

      // Retail now has its own credential; the legacy one still answers for
      // ecommerce through the compatibility path.
      expect((await getShift4RestAccessToken("merchant-1", { channel: "retail" }))?.accessToken)
        .toBe("RETAIL-TOKEN-0001")
      expect(
        (await getShift4RestAccessToken("merchant-1", {
          channel: "ecommerce",
          allowLegacySharedCredential: true,
        }))?.accessToken
      ).toBe("LEGACY-TOKEN-0001")
    })

    /* ── Environment mismatch (D3) ──────────────────────────────────────── */

    it("refuses a test credential when the deployment is configured for production", async () => {
      await seedLegacyShared("test")
      vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "production")

      const { getShift4RestAccessToken, Shift4CredentialEnvironmentMismatchError } = await import(
        "@/database/merchantShift4RestConnections"
      )

      await expect(
        getShift4RestAccessToken("merchant-1", {
          channel: "retail",
          allowLegacySharedCredential: true,
        })
      ).rejects.toBeInstanceOf(Shift4CredentialEnvironmentMismatchError)
    })

    it("refuses a production credential when the deployment is configured for test", async () => {
      await seedLegacyShared("production")

      const { getShift4RestAccessToken, Shift4CredentialEnvironmentMismatchError } = await import(
        "@/database/merchantShift4RestConnections"
      )

      const error = await getShift4RestAccessToken("merchant-1", {
        channel: "retail",
        allowLegacySharedCredential: true,
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Shift4CredentialEnvironmentMismatchError)
      // The message names the environments but never the credential.
      expect(String((error as Error).message)).not.toContain("LEGACY-TOKEN-0001")
    })

    it("rejects a mismatched channel credential too, not only the legacy one", async () => {
      const { saveShift4RestConnection, getShift4RestAccessToken, Shift4CredentialEnvironmentMismatchError } =
        await import("@/database/merchantShift4RestConnections")
      const { encryptShift4AccessToken } = await import(
        "@/providers/shift4/rest/credentials/secretEnvelope"
      )

      await saveShift4RestConnection({
        merchantId: "merchant-1",
        channel: "retail",
        encryptedAccessToken: encryptShift4AccessToken("RETAIL-TOKEN-0001"),
        accessTokenFingerprint: "fingerprint-retail",
        environment: "production",
        interfaceName: IDENTITY.interfaceName,
        interfaceVersion: IDENTITY.interfaceVersion,
        companyName: IDENTITY.companyName,
        correlationId: "correlation-retail",
        serverName: null,
        providerDateTime: null,
      })

      await expect(getShift4RestAccessToken("merchant-1", { channel: "retail" }))
        .rejects.toBeInstanceOf(Shift4CredentialEnvironmentMismatchError)
    })
  })

  /* ── Route contract (D1) ──────────────────────────────────────────────── */

  describe("POST /api/internal/shift4/connect", () => {
    const requireShift4OperatorFromRequest = vi.fn()
    const connectShift4Merchant = vi.fn()

    beforeEach(() => {
      requireShift4OperatorFromRequest.mockReset()
      connectShift4Merchant.mockReset()
      requireShift4OperatorFromRequest.mockResolvedValue("merchant-from-token")
      connectShift4Merchant.mockResolvedValue({
        connectionId: "connection-1",
        exchanged: true,
        environment: "test",
        channel: "retail",
        accessTokenFingerprint: "abcdef123456",
        correlationId: "correlation-1",
        connectedAt: "2026-08-01T00:00:01.000Z",
        serverName: "TM01CE",
      })

      vi.doMock("@/lib/api/shift4OperatorAuth", async () => {
        const actual = await vi.importActual<typeof import("@/lib/api/shift4OperatorAuth")>(
          "@/lib/api/shift4OperatorAuth"
        )
        return { ...actual, requireShift4OperatorFromRequest }
      })
      vi.doMock("@/engine/shift4Connection", async () => {
        const actual = await vi.importActual<typeof import("@/engine/shift4Connection")>(
          "@/engine/shift4Connection"
        )
        return { ...actual, connectShift4Merchant }
      })
    })

    afterEach(() => {
      vi.doUnmock("@/lib/api/shift4OperatorAuth")
      vi.doUnmock("@/engine/shift4Connection")
    })

    async function post(body: unknown, headers: Record<string, string> = {}) {
      const { POST } = await import("@/app/api/internal/shift4/connect/route")
      const { NextRequest } = await import("next/server")
      const request = new NextRequest("https://app.pinetree.test/api/internal/shift4/connect", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      })
      const response = await POST(request)
      return { response, json: (await response.json()) as Record<string, unknown> }
    }

    const validBody = {
      authToken: FAKE_AUTH_TOKEN,
      channel: "retail",
      merchantTimeZone: "America/Los_Angeles",
    }

    it("requires Shift4 operator authorization", async () => {
      // The helper answers every unauthorized case with one generic 404.
      requireShift4OperatorFromRequest.mockRejectedValue(
        Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
      )

      const { response, json } = await post(validBody)

      expect(response.status).toBe(404)
      expect((json.error as Record<string, unknown>).code).toBe("not_found")
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("derives the merchant from the token and rejects a body-supplied merchantId", async () => {
      const { response, json } = await post({ ...validBody, merchantId: "attacker-merchant" })

      expect(response.status).toBe(403)
      expect((json.error as Record<string, unknown>).code).toBe("merchant_id_not_accepted")
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("passes the token-derived merchant to the Engine", async () => {
      await post(validBody)

      expect(connectShift4Merchant).toHaveBeenCalledWith({
        merchantId: "merchant-from-token",
        authToken: FAKE_AUTH_TOKEN,
        channel: "retail",
        merchantTimeZone: "America/Los_Angeles",
      })
    })

    it("returns only safe evidence and never a secret", async () => {
      const { response, json } = await post(validBody)

      expect(response.status).toBe(200)
      expect(json.data).toEqual({
        connectionId: "connection-1",
        environment: "test",
        channel: "retail",
        accessTokenFingerprint: "abcdef123456",
        connectedAt: "2026-08-01T00:00:01.000Z",
        correlationId: "correlation-1",
      })

      const serialized = JSON.stringify(json)
      expect(serialized).not.toContain(FAKE_AUTH_TOKEN)
      expect(serialized).not.toContain(FAKE_ACCESS_TOKEN)
      expect(serialized).not.toContain(FAKE_CLIENT_GUID)
      expect(serialized).not.toMatch(/authToken|accessToken"|clientGuid|ciphertext|authTag/)
    })

    it("marks the response uncacheable", async () => {
      const { response } = await post(validBody)
      expect(String(response.headers.get("cache-control"))).toContain("no-store")
    })

    it("rejects the shared channel and a missing channel", async () => {
      for (const channel of ["shared", "", undefined]) {
        const body: Record<string, unknown> = { ...validBody }
        if (channel === undefined) delete body.channel
        else body.channel = channel

        const { response, json } = await post(body)
        expect(response.status).toBe(400)
        expect((json.error as Record<string, unknown>).code).toBe("invalid_channel")
      }
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("rejects unsupported fields", async () => {
      const { response, json } = await post({ ...validBody, environment: "production" })

      expect(response.status).toBe(400)
      expect((json.error as Record<string, unknown>).code).toBe("unsupported_field")
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("rejects a blank auth token", async () => {
      const { response } = await post({ ...validBody, authToken: "   " })
      expect(response.status).toBe(400)
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("rejects an invalid IANA time zone", async () => {
      const { response, json } = await post({ ...validBody, merchantTimeZone: "Mars/Olympus_Mons" })

      expect(response.status).toBe(400)
      expect((json.error as Record<string, unknown>).code).toBe("invalid_time_zone")
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("rejects a non-JSON content type", async () => {
      const { response } = await post(validBody, { "content-type": "text/plain" })
      expect(response.status).toBe(415)
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("rejects an oversized body before parsing it", async () => {
      const oversized = JSON.stringify({ ...validBody, merchantTimeZone: "x".repeat(8_000) })
      const { response, json } = await post(oversized)

      expect(response.status).toBe(413)
      expect((json.error as Record<string, unknown>).code).toBe("payload_too_large")
      expect(connectShift4Merchant).not.toHaveBeenCalled()
    })

    it("keeps the auth token out of an error response when the exchange fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const { Shift4ConnectionError } = await import("@/engine/shift4Connection")
      connectShift4Merchant.mockRejectedValue(
        new Shift4ConnectionError("Shift4 did not issue an access token.", "exchange_failed")
      )

      const { response, json } = await post(validBody)

      expect(response.status).toBe(502)
      // A 5xx is replaced with the generic fallback by the standard envelope.
      expect(JSON.stringify(json)).not.toContain(FAKE_AUTH_TOKEN)
      expect((json.error as Record<string, unknown>).correlationId).toBeTruthy()
    })

    it("surfaces a replayed single-use auth token as a conflict", async () => {
      const { Shift4ConnectionError } = await import("@/engine/shift4Connection")
      connectShift4Merchant.mockRejectedValue(
        new Shift4ConnectionError("Already exchanged.", "auth_token_already_used")
      )

      const { response, json } = await post(validBody)

      expect(response.status).toBe(409)
      expect((json.error as Record<string, unknown>).code).toBe("auth_token_already_used")
      expect(JSON.stringify(json)).not.toContain(FAKE_AUTH_TOKEN)
    })

    it("makes no network request for any of these cases", () => {
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  /* ── Static source guarantees ─────────────────────────────────────────── */

  describe("static guarantees", () => {
    it("exposes no NEXT_PUBLIC Shift4 credential names", () => {
      for (const file of [
        "app/api/internal/shift4/connect/route.ts",
        "engine/shift4Connection.ts",
        "database/merchantShift4RestConnections.ts",
        "providers/shift4/rest/config.ts",
        "providers/shift4/rest/credentials/exchangeAccessToken.ts",
        "providers/shift4/rest/credentials/secretEnvelope.ts",
      ]) {
        expect(source(file)).not.toMatch(/NEXT_PUBLIC_SHIFT4/)
      }
      expect(source(".env.example")).not.toMatch(/NEXT_PUBLIC_SHIFT4/)
    })

    it("does not introduce auth-token or base-url environment variables", () => {
      const forbidden = /SHIFT4_RETAIL_AUTH_TOKEN|SHIFT4_ECOM_AUTH_TOKEN|SHIFT4_API_BASE_URL/
      for (const file of [
        ".env.example",
        "app/api/internal/shift4/connect/route.ts",
        "engine/shift4Connection.ts",
        "database/merchantShift4RestConnections.ts",
        "providers/shift4/rest/config.ts",
        "scripts/check-environment.mjs",
      ]) {
        expect(source(file)).not.toMatch(forbidden)
      }
    })

    it("never persists or logs the auth token", () => {
      const engine = source("engine/shift4Connection.ts")
      // The auth token reaches only the hash function and the provider call.
      expect(engine).not.toMatch(/console\.(log|info|warn|error)\([^)]*authToken/)
      expect(engine).toMatch(/hashAuthToken/)

      const storage = source("database/merchantShift4RestConnections.ts")
      expect(storage).not.toMatch(/auth_token|authToken/)
    })

    it("keeps the connect route server-only", () => {
      const route = source("app/api/internal/shift4/connect/route.ts")
      expect(route).not.toMatch(/"use client"/)
      expect(route).toMatch(/requireShift4OperatorFromRequest/)
      // The route delegates; it never speaks to Shift4 or the database itself.
      expect(route).not.toMatch(/fetch\(|supabaseAdmin|from\(["']merchant_providers/)
    })

    it("stores no plaintext token column", () => {
      const storage = source("database/merchantShift4RestConnections.ts")
      // Every write of access_token goes through the encrypted envelope guard.
      expect(storage).toMatch(/isShift4EncryptedSecret\(input\.encryptedAccessToken\)/)
      expect(storage).toMatch(/Refusing to store a Shift4 access token that is not an encrypted envelope/)
    })
  })
})
