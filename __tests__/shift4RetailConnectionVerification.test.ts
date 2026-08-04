/**
 * Shift4 Retail connection verification — security and read-only contracts.
 *
 * Covers the one new operator action: a read-only Merchant Information lookup
 * that proves the STORED Retail credential still authenticates.
 *
 * NO NETWORK REQUEST IS MADE. The provider adapter, the credential store and
 * the operator-authorization helper are all mocked, and a guard replaces global
 * fetch with a throwing stub for every test in this file.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const source = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8")

/**
 * Strip comments so a "no code does X" assertion cannot be satisfied — or
 * broken — by prose. These modules document what they refuse to do, so the
 * refusals themselves name the forbidden things.
 */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

/** The 12 safe fields, in the order Object.keys().sort() produces. */
const SAFE_EVIDENCE_KEYS = [
  "capabilities",
  "channel",
  "connectionId",
  "correlationId",
  "credentialSource",
  "doesNotProve",
  "environment",
  "operation",
  "proves",
  "providerDateTime",
  "serverName",
  "verifiedAt",
]

const engineSource = source("engine/shift4/verifyRetailConnection.ts")
const routeSource = source("app/api/internal/shift4/retail-verification/route.ts")
const clientSource = source("lib/shift4/retailVerification.ts")
const cardSource = source("components/dashboard/Shift4RetailVerificationCard.tsx")
const adminSection = source("components/admin/Shift4SandboxOperationsSection.tsx")

/** Any real network call in this file is a test failure, not a slow test. */
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error("A test attempted a real network request")
  }) as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/* ── Engine ─────────────────────────────────────────────────────────────── */

describe("verifyShift4RetailConnection", () => {
  const getShift4RestAccessToken = vi.fn()
  const getMerchantInformation = vi.fn()
  const logShift4Event = vi.fn()

  const STORED_ACCESS_TOKEN = "STORED-ACCESS-TOKEN-VALUE-0000000000"

  beforeEach(() => {
    vi.stubEnv("SHIFT4_REST_ENABLED", "true")
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", "PineTreePayments")
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "1.0.0")
    vi.stubEnv("SHIFT4_COMPANY_NAME", "PineTree Payments")
    vi.stubEnv("SHIFT4_CLIENT_GUID", "99999999-8888-7777-6666666666666666")

    getShift4RestAccessToken.mockReset()
    getMerchantInformation.mockReset()
    logShift4Event.mockReset()

    getShift4RestAccessToken.mockResolvedValue({
      connectionId: "connection-1",
      environment: "test",
      channel: "retail",
      source: "channel",
      accessToken: STORED_ACCESS_TOKEN,
    })
    getMerchantInformation.mockResolvedValue({
      voiceCenterAccountNumber: null,
      voiceCenterPhoneNumber: null,
      outcome: "approved",
      correlationId: "provider-correlation",
      serverName: "TM01CE",
      providerDateTime: "2026-08-03T12:00:00.000-05:00",
      httpStatus: 200,
    })

    vi.doMock("@/database/merchantShift4RestConnections", async () => {
      const actual = await vi.importActual<
        typeof import("@/database/merchantShift4RestConnections")
      >("@/database/merchantShift4RestConnections")
      return { ...actual, getShift4RestAccessToken }
    })
    vi.doMock("@/providers/shift4/rest", async () => {
      const actual = await vi.importActual<typeof import("@/providers/shift4/rest")>(
        "@/providers/shift4/rest"
      )
      return { ...actual, getMerchantInformation }
    })
    vi.doMock("@/engine/shift4/observability", async () => {
      const actual = await vi.importActual<typeof import("@/engine/shift4/observability")>(
        "@/engine/shift4/observability"
      )
      return { ...actual, logShift4Event }
    })
  })

  afterEach(() => {
    vi.doUnmock("@/database/merchantShift4RestConnections")
    vi.doUnmock("@/providers/shift4/rest")
    vi.doUnmock("@/engine/shift4/observability")
    vi.resetModules()
  })

  async function verify(merchantId = "merchant-1") {
    const { verifyShift4RetailConnection } = await import(
      "@/engine/shift4/verifyRetailConnection"
    )
    return verifyShift4RetailConnection(merchantId)
  }

  it("selects the stored Retail credential and never the E-commerce one", async () => {
    await verify()

    expect(getShift4RestAccessToken).toHaveBeenCalledTimes(1)
    const [merchantId, options] = getShift4RestAccessToken.mock.calls[0]
    expect(merchantId).toBe("merchant-1")
    expect(options.channel).toBe("retail")
    // No call anywhere in the module can request the E-commerce credential.
    expect(engineSource).not.toContain("ecommerce")
  })

  it("does not fall back to a legacy shared credential", async () => {
    await verify()
    expect(getShift4RestAccessToken.mock.calls[0][1].allowLegacySharedCredential).toBe(false)
  })

  it("performs exactly one read-only Merchant Information lookup", async () => {
    const result = await verify()

    expect(getMerchantInformation).toHaveBeenCalledTimes(1)
    expect(result.operation).toBe("merchant_information")

    // No transaction-creating or credential-issuing operation is reachable.
    for (const forbidden of [
      "authorization",
      "manual_authorization",
      "capture",
      "sale",
      "refund",
      "void",
      "exchangeAccessToken",
      "access_token_exchange",
      "saveShift4RestConnection",
    ]) {
      expect(engineSource, forbidden).not.toContain(`${forbidden}(`)
    }
  })

  it("passes the decrypted stored token to the adapter and returns none of it", async () => {
    const result = await verify()

    expect(getMerchantInformation.mock.calls[0][0].accessToken).toBe(STORED_ACCESS_TOKEN)
    expect(JSON.stringify(result)).not.toContain(STORED_ACCESS_TOKEN)
    expect(JSON.stringify(result)).not.toContain("accessToken")
  })

  it("returns only safe, explicitly built evidence", async () => {
    const result = await verify()

    expect(Object.keys(result).sort()).toEqual(SAFE_EVIDENCE_KEYS)
    expect(result.channel).toBe("retail")
    expect(result.environment).toBe("test")
    expect(result.connectionId).toBe("connection-1")
    expect(result.serverName).toBe("TM01CE")

    // The provider's raw response, voice-center contact details, headers and
    // request body are all absent.
    const serialized = JSON.stringify(result)
    for (const forbidden of ["voiceCenter", "redactedResponse", "rawResponseRef", "httpStatus"]) {
      expect(serialized, forbidden).not.toContain(forbidden)
    }
  })

  it("states what the check does not prove", async () => {
    const result = await verify()

    expect(result.proves).toBe("stored_retail_authentication_usable")
    expect(result.doesNotProve).toEqual([
      "certification",
      "terminal_readiness",
      "card_processing_approval",
      "production_eligibility",
    ])
  })

  it("does not mark card processing certified or enable Retail processing", async () => {
    vi.stubEnv("SHIFT4_RETAIL_ENABLED", "")
    const result = await verify()

    expect(result.capabilities.retailProcessingEnabled).toBe(false)
    // The module reports flags; no CODE writes the verified column or a gate.
    // (The doc comment names `card_processing_verified` precisely to forbid it.)
    expect(codeOnly(engineSource)).not.toContain("card_processing_verified")
    expect(codeOnly(engineSource)).not.toMatch(/SHIFT4_RETAIL_ENABLED\s*=/)
    expect(codeOnly(engineSource)).not.toMatch(/\b(update|insert|upsert|delete)\s*\(/i)
  })

  it("logs one safe success event with allowlisted fields only", async () => {
    await verify()

    expect(logShift4Event).toHaveBeenCalledTimes(1)
    const [level, event, fields] = logShift4Event.mock.calls[0]
    expect(level).toBe("info")
    expect(event).toBe("shift4_retail_connection_verified")
    expect(Object.keys(fields).sort()).toEqual([
      "channel",
      "connectionId",
      "correlationId",
      "environment",
      "merchantId",
      "serverName",
      "verifiedAt",
    ])
    expect(JSON.stringify(fields)).not.toContain(STORED_ACCESS_TOKEN)
  })

  it("keeps every logged field on the shared Shift4 log allowlist", async () => {
    await verify()
    const { safeShift4LogFields } = await vi.importActual<
      typeof import("@/engine/shift4/observability")
    >("@/engine/shift4/observability")

    const fields = logShift4Event.mock.calls[0][2] as Record<string, unknown>
    // Nothing is dropped by the allowlist, so the event is complete as logged.
    expect(Object.keys(safeShift4LogFields(fields)).sort()).toEqual(Object.keys(fields).sort())
  })

  it("fails closed when the REST integration is disabled", async () => {
    vi.stubEnv("SHIFT4_REST_ENABLED", "")

    await expect(verify()).rejects.toMatchObject({ code: "rest_disabled" })
    expect(getShift4RestAccessToken).not.toHaveBeenCalled()
    expect(getMerchantInformation).not.toHaveBeenCalled()
  })

  it("fails closed when no stored Retail credential exists", async () => {
    getShift4RestAccessToken.mockResolvedValue(null)

    await expect(verify()).rejects.toMatchObject({ code: "connection_unavailable" })
    expect(getMerchantInformation).not.toHaveBeenCalled()
  })

  it("fails closed on a stored-environment mismatch", async () => {
    const { Shift4CredentialEnvironmentMismatchError } = await vi.importActual<
      typeof import("@/database/merchantShift4RestConnections")
    >("@/database/merchantShift4RestConnections")
    getShift4RestAccessToken.mockRejectedValue(
      new Shift4CredentialEnvironmentMismatchError({
        storedEnvironment: "production",
        configuredEnvironment: "test",
        channel: "retail",
      })
    )

    await expect(verify()).rejects.toMatchObject({ code: "environment_mismatch" })
    expect(getMerchantInformation).not.toHaveBeenCalled()
  })

  it("treats a non-approved provider outcome as a failure, without retrying", async () => {
    getMerchantInformation.mockResolvedValue({
      voiceCenterAccountNumber: null,
      voiceCenterPhoneNumber: null,
      outcome: "provider_error",
      correlationId: "provider-correlation",
      serverName: "TM01CE",
      providerDateTime: null,
      httpStatus: 400,
    })

    await expect(verify()).rejects.toMatchObject({ code: "verification_failed" })
    // One attempt only. The Engine never re-dispatches.
    expect(getMerchantInformation).toHaveBeenCalledTimes(1)
    expect(logShift4Event).not.toHaveBeenCalled()
  })
})

/* ── Route ──────────────────────────────────────────────────────────────── */

describe("POST /api/internal/shift4/retail-verification", () => {
  const requireShift4OperatorFromRequest = vi.fn()
  const verifyShift4RetailConnection = vi.fn()

  beforeEach(() => {
    requireShift4OperatorFromRequest.mockReset()
    verifyShift4RetailConnection.mockReset()
    requireShift4OperatorFromRequest.mockResolvedValue("merchant-from-token")
    verifyShift4RetailConnection.mockResolvedValue({
      connectionId: "connection-1",
      environment: "test",
      channel: "retail",
      credentialSource: "channel",
      operation: "merchant_information",
      serverName: "TM01CE",
      providerDateTime: "2026-08-03T12:00:00.000-05:00",
      verifiedAt: "2026-08-03T17:00:00.000Z",
      correlationId: "correlation-1",
      proves: "stored_retail_authentication_usable",
      doesNotProve: [
        "certification",
        "terminal_readiness",
        "card_processing_approval",
        "production_eligibility",
      ],
      capabilities: { restApiEnabled: true, retailProcessingEnabled: false },
    })

    vi.doMock("@/lib/api/shift4OperatorAuth", async () => {
      const actual = await vi.importActual<typeof import("@/lib/api/shift4OperatorAuth")>(
        "@/lib/api/shift4OperatorAuth"
      )
      return { ...actual, requireShift4OperatorFromRequest }
    })
    vi.doMock("@/engine/shift4/verifyRetailConnection", async () => {
      const actual = await vi.importActual<
        typeof import("@/engine/shift4/verifyRetailConnection")
      >("@/engine/shift4/verifyRetailConnection")
      return { ...actual, verifyShift4RetailConnection }
    })
  })

  afterEach(() => {
    vi.doUnmock("@/lib/api/shift4OperatorAuth")
    vi.doUnmock("@/engine/shift4/verifyRetailConnection")
    vi.resetModules()
  })

  async function post(body?: unknown) {
    const { POST } = await import("@/app/api/internal/shift4/retail-verification/route")
    const { NextRequest } = await import("next/server")
    const request = new NextRequest(
      "https://app.pinetree.test/api/internal/shift4/retail-verification",
      {
        method: "POST",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }
    )
    const response = await POST(request)
    return { response, json: (await response.json()) as Record<string, unknown> }
  }

  it("rejects an ordinary merchant with the generic operator response", async () => {
    // A merchant fails the operator check exactly like anyone else: one 404.
    requireShift4OperatorFromRequest.mockRejectedValue(
      Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
    )

    const { response, json } = await post()

    expect(response.status).toBe(404)
    expect((json.error as Record<string, unknown>).code).toBe("not_found")
    expect(verifyShift4RetailConnection).not.toHaveBeenCalled()
  })

  it("rejects a PineTree admin who is not the configured operator", async () => {
    // getShift4OperatorStatusFromRequest requires admin AND the exact email, so
    // a non-operator admin reaches the same generic rejection.
    requireShift4OperatorFromRequest.mockRejectedValue(
      Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
    )

    const { response } = await post()

    expect(response.status).toBe(404)
    expect(verifyShift4RetailConnection).not.toHaveBeenCalled()
  })

  it("allows the exact authorized operator", async () => {
    const { response, json } = await post()

    expect(response.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(verifyShift4RetailConnection).toHaveBeenCalledTimes(1)
  })

  it("derives merchant identity from the session only", async () => {
    await post()
    expect(verifyShift4RetailConnection).toHaveBeenCalledWith("merchant-from-token")
    // The Engine takes exactly one argument, so nothing else can be selected.
    expect(verifyShift4RetailConnection.mock.calls[0]).toHaveLength(1)
  })

  it("refuses caller-supplied merchant, channel, environment or credential input", async () => {
    for (const body of [
      { merchantId: "attacker-merchant" },
      { channel: "ecommerce" },
      { environment: "production" },
      { email: "someone@example.test" },
      { clientGuid: "11111111-2222-3333-4444444444444444" },
      { accessToken: "ATTACKER-TOKEN" },
    ]) {
      const { response, json } = await post(body)
      expect(response.status, JSON.stringify(body)).toBe(403)
      expect((json.error as Record<string, unknown>).code).toBe("caller_input_not_accepted")
    }
    expect(verifyShift4RetailConnection).not.toHaveBeenCalled()
  })

  it("returns only the safe evidence fields", async () => {
    const { json } = await post()
    const data = json.data as Record<string, unknown>

    expect(Object.keys(data).sort()).toEqual(SAFE_EVIDENCE_KEYS)

    const serialized = JSON.stringify(json)
    for (const forbidden of [
      "accessToken",
      "authToken",
      "clientGuid",
      "ciphertext",
      "voiceCenter",
      "redactedResponse",
      "credentials",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden)
    }
  })

  it("answers a failure with a generic message and a correlation ID", async () => {
    const { Shift4RetailVerificationError } = await vi.importActual<
      typeof import("@/engine/shift4/verifyRetailConnection")
    >("@/engine/shift4/verifyRetailConnection")
    verifyShift4RetailConnection.mockRejectedValue(
      new Shift4RetailVerificationError(
        "Shift4 did not confirm the stored Retail credential.",
        "verification_failed"
      )
    )

    const { response, json } = await post()
    const error = json.error as Record<string, unknown>

    expect(response.status).toBe(502)
    expect(error.code).toBe("verification_failed")
    expect(typeof error.correlationId).toBe("string")
    // No provider body, header, token or stack trace.
    expect(JSON.stringify(json)).not.toContain("stack")
    expect(JSON.stringify(json)).not.toContain("AccessToken")
  })

  it("is uncacheable", async () => {
    const { response } = await post()
    expect(response.headers.get("Cache-Control")).toContain("no-store")
  })

  it("exposes no GET handler that could be prefetched", async () => {
    const route = await import("@/app/api/internal/shift4/retail-verification/route")
    expect("GET" in route).toBe(false)
  })
})

/* ── Browser client and interface ───────────────────────────────────────── */

describe("retail verification client", () => {
  async function submit(fetchImpl: typeof fetch, timeoutMs?: number) {
    const { submitRetailVerification } = await import("@/lib/shift4/retailVerification")
    return submitRetailVerification({
      getBearerToken: async () => "bearer-token",
      fetchImpl,
      timeoutMs,
    })
  }

  it("dispatches exactly one request with no body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { connectionId: "connection-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch

    await submit(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [path, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toBe("/api/internal/shift4/retail-verification")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
  })

  it("never retries automatically on failure", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { message: "nope", correlationId: "c1" } }), {
        status: 502,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch

    const outcome = await submit(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe("failure")
    if (outcome.status === "failure") {
      expect(outcome.failure.correlationId).toBe("c1")
      expect(outcome.failure.reviewRequired).toBe(true)
    }
    // No retry construct exists in the module's CODE. (The doc comment says
    // "No automatic retry", which is why the source text is stripped first.)
    expect(codeOnly(clientSource)).not.toMatch(/\bretry\b|while\s*\(|for\s*\(/i)
  })

  it("surfaces no provider detail from a transport failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED 10.0.0.1:443 AccessToken=SECRET")
    }) as unknown as typeof fetch

    const outcome = await submit(fetchImpl)

    expect(outcome.status).toBe("failure")
    if (outcome.status === "failure") {
      expect(outcome.failure.message).toBe("The verification request could not be completed.")
      expect(outcome.failure.reviewRequired).toBe(true)
      expect(JSON.stringify(outcome)).not.toContain("SECRET")
      expect(JSON.stringify(outcome)).not.toContain("ECONNREFUSED")
    }
  })

  it("blocks a second submission while one is in flight", async () => {
    // The card guards with a ref so the block is synchronous, before React can
    // re-render with `submitting` set.
    expect(cardSource).toContain("const inFlightRef = useRef(false)")
    expect(cardSource).toContain("if (inFlightRef.current) return")
    expect(cardSource).toContain("inFlightRef.current = true")
    expect(cardSource).toContain("disabled={!canSubmit}")

    const { canSubmitRetailVerification } = await import("@/lib/shift4/retailVerification")
    expect(canSubmitRetailVerification({ submitting: false })).toBe(true)
    expect(canSubmitRetailVerification({ submitting: true })).toBe(false)
  })

  it("runs only on an explicit click, never on mount and never on a timer", async () => {
    expect(cardSource).toContain('onClick={() => void verify()}')
    // No effect, interval, or timeout can fire the verification.
    expect(cardSource).not.toContain("useEffect")
    expect(cardSource).not.toContain("setInterval")
    expect(cardSource).not.toContain("setTimeout")
  })

  it("uses the required button label", () => {
    expect(cardSource).toContain("Verify Shift4 Retail Connection")
  })
})

/* ── Placement and layering ─────────────────────────────────────────────── */

describe("placement", () => {
  it("lives in the admin Shift4 sandbox section only", () => {
    expect(adminSection).toContain("Shift4RetailVerificationCard")
    // The merchant Providers page carries no Shift4 sandbox tooling.
    const providers = source("app/dashboard/providers/page.tsx")
    expect(providers).not.toContain("Shift4RetailVerificationCard")
    expect(providers).not.toContain("retail-verification")
    expect(providers).not.toContain("Verify Shift4 Retail Connection")
  })

  it("keeps the UI -> API -> Engine -> adapter layering", () => {
    // The card talks to the route, never to the Engine or the provider.
    expect(cardSource).toContain('from "@/lib/shift4/retailVerification"')
    expect(cardSource).not.toContain("@/engine/")
    expect(cardSource).not.toContain("@/providers/")
    expect(cardSource).not.toContain("@/database/")

    // The route talks to the Engine, never to the provider or the database.
    expect(routeSource).toContain("@/engine/shift4/verifyRetailConnection")
    expect(routeSource).not.toContain("@/providers/")
    expect(routeSource).not.toContain("@/database/")

    // The Engine uses the shared adapter; it never calls fetch itself.
    expect(engineSource).toContain('from "@/providers/shift4/rest"')
    expect(engineSource).not.toContain("fetch(")
  })

  it("reuses the existing Merchant Information adapter rather than duplicating it", () => {
    expect(engineSource).toContain("getMerchantInformation")
    // No second implementation of the operation exists.
    const adapter = source("providers/shift4/rest/merchants/getMerchantInformation.ts")
    expect(adapter).toContain('operation: "merchant_information"')
    // The Engine reaches Shift4 only through the adapter: no direct client call
    // and no endpoint path of its own. (The doc comment cites the path, so the
    // source text is stripped to its code first.)
    expect(codeOnly(engineSource)).not.toContain("shift4RestRequest")
    expect(codeOnly(engineSource)).not.toContain("/merchants/merchant")
  })

  it("routes through the shared client's headers, redaction and timeouts", () => {
    const client = source("providers/shift4/rest/client.ts")
    for (const header of ["InterfaceName", "InterfaceVersion", "CompanyName", "AccessToken"]) {
      expect(client, header).toContain(header)
    }
    expect(client).toContain("shift4SafeBodySummary")
    expect(client).toContain("shift4TimeoutForOperation")
  })

  it("keeps merchant_information classified as a read-only lookup", async () => {
    const { SHIFT4_TRANSACTION_CREATING_OPERATIONS, isShift4TransactionCreatingOperation } =
      await vi.importActual<typeof import("@/providers/shift4/rest/types")>(
        "@/providers/shift4/rest/types"
      )
    expect(SHIFT4_TRANSACTION_CREATING_OPERATIONS).not.toContain("merchant_information")
    expect(isShift4TransactionCreatingOperation("merchant_information")).toBe(false)
  })
})
