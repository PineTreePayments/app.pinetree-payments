/**
 * Shift4 Payment Platform REST API - Phase 1 foundation tests.
 *
 * All fixtures are SANITIZED. Every credential-shaped value below is invented
 * for tests only; no Shift4-supplied test or production credential appears in
 * this file, and none may ever be added.
 *
 * Response fixtures follow the official envelope and field names from
 * https://docs.shift4.com/apis/payments-platform-rest/openapi and the documented
 * test-server triggers (amount.total drives transaction.responseCode).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  assertValidShift4Invoice,
  buildShift4Headers,
  buildTokenTransactionRequest,
  containsShift4Secret,
  createInvoiceReference,
  describeShift4Error,
  getShift4RestConfig,
  invoiceMatchesReference,
  isShift4CommunicationErrorCode,
  isShift4UnknownOutcomeError,
  minorUnitsToShift4Amount,
  normalizeShift4Response,
  redactShift4Headers,
  redactShift4Payload,
  refund,
  sale,
  SHIFT4_COMMUNICATION_ERROR_CODES,
  SHIFT4_REDACTED,
  SHIFT4_REST_PRODUCTION_BASE_URL,
  SHIFT4_REST_TEST_BASE_URL,
  Shift4ConfigError,
  Shift4RestApiError,
  Shift4RestInvalidResponseError,
  Shift4RestTransportError,
  shift4BaseUrlForEnvironment,
  shift4RestRequest,
  shift4ResultForLog,
  shift4SafeBodySummary,
  type Shift4RestConfig,
} from "@/providers/shift4/rest"
import {
  decryptShift4AccessToken,
  encryptShift4AccessToken,
  isShift4EncryptedSecret,
} from "@/providers/shift4/rest/credentials/secretEnvelope"
import {
  exchangeAccessToken,
  formatShift4DateTime,
} from "@/providers/shift4/rest/credentials/exchangeAccessToken"
import { getInvoice } from "@/providers/shift4/rest/invoices/getInvoice"
import { voidInvoice } from "@/providers/shift4/rest/invoices/voidInvoice"

/* ── Sanitized fixtures ──────────────────────────────────────────────────── */

/** Invented, non-functional. Shaped like the documented examples. */
const FAKE_CLIENT_GUID = "AAAAAAAA-1111-2222-333344445555AAAA"
const FAKE_AUTH_TOKEN = "BBBBBBBB-3333-4444-555566667777BBBB"
const FAKE_ACCESS_TOKEN = "CCCCCCCC-5555-6666-7777-888899990000"
/** 64 hex characters. Test-only key; never a deployment value. */
const FAKE_ENCRYPTION_KEY = "a".repeat(64)

const TEST_IDENTITY = {
  interfaceName: "PineTreePayments",
  interfaceVersion: "1.0",
  companyName: "PineTree",
}

function testConfig(overrides: Partial<Shift4RestConfig> = {}): Shift4RestConfig {
  return {
    environment: "test",
    baseUrl: SHIFT4_REST_TEST_BASE_URL,
    integrationMethod: "host_direct",
    identity: TEST_IDENTITY,
    ...overrides,
  }
}

/** Approved sale, matching the documented envelope. */
function approvedSaleBody(invoice = "1234567890") {
  return {
    result: [
      {
        dateTime: "2026-07-30T09:18:23.283-07:00",
        amount: { total: 25.5, tax: 0 },
        card: {
          entryMode: "E",
          type: "VS",
          present: "N",
          number: "XXXXXXXXXXXX1111",
          token: { value: "TOKEN00000000001" },
          securityCode: { result: "M" },
        },
        transaction: {
          authorizationCode: "OK1234",
          invoice,
          responseCode: "A",
          retrievalReference: "REF123456789",
          saleFlag: "S",
          avs: { result: "Y" },
        },
        server: { name: "TM01CE" },
      },
    ],
  }
}

/** Declined sale (test trigger: amount.total above 999,999). */
function declinedSaleBody(invoice = "1234567890") {
  return {
    result: [
      {
        dateTime: "2026-07-30T09:18:24.000-07:00",
        amount: { total: 1000000, tax: 0 },
        card: { entryMode: "E", type: "MC", present: "N" },
        transaction: { invoice, responseCode: "D", saleFlag: "S" },
        server: { name: "TM01CE" },
      },
    ],
  }
}

function errorBody(code: number, shortText = "Comm Error", longText = "Communication failure") {
  return {
    result: [
      {
        error: {
          code,
          severity: "Error",
          shortText,
          longText,
          primaryCode: 9,
          secondaryCode: 12,
        },
        server: { name: "TM01CE" },
      },
    ],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function fetchReturning(response: Response | (() => Promise<Response>)) {
  // The generic types `mock.calls` as [string, RequestInit?], so assertions on
  // the request URL and init need no unchecked cast, while the implementation
  // itself declares no unused parameters.
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    typeof response === "function" ? response() : response
  )
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.stubEnv("SHIFT4_CREDENTIAL_ENCRYPTION_KEY", FAKE_ENCRYPTION_KEY)
  vi.stubEnv("SHIFT4_CLIENT_GUID", FAKE_CLIENT_GUID)

  // Network guard: every test injects its own fetch. A test that reaches the
  // real Shift4 host would be slow, flaky, and would contact a live gateway, so
  // the global is replaced with one that fails loudly instead.
  vi.stubGlobal("fetch", () => {
    throw new Error("Unexpected network call in a Shift4 unit test. Inject fetchImpl instead.")
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ── Environment URL selection ───────────────────────────────────────────── */

describe("Shift4 REST environment configuration", () => {
  it("selects the documented test and production base URLs", () => {
    expect(shift4BaseUrlForEnvironment("test")).toBe("https://api.shift4test.com/api/rest/v1")
    expect(shift4BaseUrlForEnvironment("production")).toBe("https://api.shift4api.net/api/rest/v1")
    expect(SHIFT4_REST_TEST_BASE_URL).not.toBe(SHIFT4_REST_PRODUCTION_BASE_URL)
  })

  it("resolves the base URL from the configured environment", () => {
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "production")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", TEST_IDENTITY.interfaceName)
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", TEST_IDENTITY.interfaceVersion)
    vi.stubEnv("SHIFT4_COMPANY_NAME", TEST_IDENTITY.companyName)

    expect(getShift4RestConfig().baseUrl).toBe(SHIFT4_REST_PRODUCTION_BASE_URL)
  })

  it("fails closed instead of defaulting to an environment", () => {
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "")
    expect(() => getShift4RestConfig()).toThrow(Shift4ConfigError)

    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "staging")
    expect(() => getShift4RestConfig()).toThrow(/test.*production/i)
  })

  it("reports missing interface identity rather than sending empty headers", () => {
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", "")
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "")
    vi.stubEnv("SHIFT4_COMPANY_NAME", "")

    expect(() => getShift4RestConfig()).toThrow(/SHIFT4_INTERFACE_NAME/)
  })

  it("rejects identity values that break Shift4's documented character rules", () => {
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", "Pine-Tree")
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "1.0")
    vi.stubEnv("SHIFT4_COMPANY_NAME", "PineTree")

    expect(() => getShift4RestConfig()).toThrow(/does not allow/i)
  })

  it("rejects an interface version longer than the documented maximum", () => {
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", TEST_IDENTITY.interfaceName)
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", "1".repeat(12))
    vi.stubEnv("SHIFT4_COMPANY_NAME", TEST_IDENTITY.companyName)

    expect(() => getShift4RestConfig()).toThrow(/maximum length/i)
  })
})

/* ── Required header construction ────────────────────────────────────────── */

describe("Shift4 REST header construction", () => {
  it("sends the four documented headers on an authenticated request", () => {
    const headers = buildShift4Headers({
      operation: "sale",
      config: testConfig(),
      accessToken: FAKE_ACCESS_TOKEN,
      hasBody: true,
    })

    expect(headers.InterfaceName).toBe(TEST_IDENTITY.interfaceName)
    expect(headers.InterfaceVersion).toBe(TEST_IDENTITY.interfaceVersion)
    expect(headers.CompanyName).toBe(TEST_IDENTITY.companyName)
    expect(headers.AccessToken).toBe(FAKE_ACCESS_TOKEN)
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("omits AccessToken on the access-token exchange, which produces one", () => {
    const headers = buildShift4Headers({
      operation: "access_token_exchange",
      config: testConfig(),
      hasBody: true,
    })

    expect(headers.AccessToken).toBeUndefined()
    expect(headers.InterfaceName).toBe(TEST_IDENTITY.interfaceName)
  })

  it("requires the Invoice header on invoice lookup and void", () => {
    for (const operation of ["invoice_information", "void"] as const) {
      expect(() =>
        buildShift4Headers({
          operation,
          config: testConfig(),
          accessToken: FAKE_ACCESS_TOKEN,
          hasBody: false,
        })
      ).toThrow(/Invoice header/i)

      const headers = buildShift4Headers({
        operation,
        config: testConfig(),
        accessToken: FAKE_ACCESS_TOKEN,
        invoice: "1234567890",
        hasBody: false,
      })
      expect(headers.Invoice).toBe("1234567890")
    }
  })

  it("refuses an authenticated operation with no access token", () => {
    expect(() =>
      buildShift4Headers({ operation: "sale", config: testConfig(), hasBody: true })
    ).toThrow(/access token/i)
  })
})

/* ── Secret redaction ────────────────────────────────────────────────────── */

describe("Shift4 redaction", () => {
  it("redacts credential headers but keeps the header names visible", () => {
    const redacted = redactShift4Headers({
      AccessToken: FAKE_ACCESS_TOKEN,
      InterfaceName: "PineTreePayments",
      Authorization: "HMAC-SHA256 Credential=KEY&Signature=abc",
      Invoice: "1234567890",
    })

    expect(redacted.AccessToken).toBe(SHIFT4_REDACTED)
    expect(redacted.Authorization).toBe(SHIFT4_REDACTED)
    expect(redacted.InterfaceName).toBe("PineTreePayments")
    expect(redacted.Invoice).toBe("1234567890")
  })

  it("redacts PAN, security-code input, tokens, and credentials in a payload", () => {
    const redacted = redactShift4Payload({
      credential: { authToken: FAKE_AUTH_TOKEN, clientGuid: FAKE_CLIENT_GUID },
      card: {
        number: "4111111111111111",
        expirationDate: 1230,
        token: { value: "TOKEN00000000001" },
        securityCode: { indicator: "1", value: "123", result: "M" },
      },
      emv: { tlvData: "9F2701809F3602" },
      transaction: { invoice: "1234567890", responseCode: "A" },
    }) as Record<string, Record<string, unknown>>

    expect(redacted.credential.authToken).toBe(SHIFT4_REDACTED)
    expect(redacted.credential.clientGuid).toBe(SHIFT4_REDACTED)
    expect(redacted.card.number).toBe(SHIFT4_REDACTED)
    expect(redacted.card.expirationDate).toBe(SHIFT4_REDACTED)
    expect(redacted.emv).toBe(SHIFT4_REDACTED)

    const card = redacted.card as unknown as {
      token: string
      securityCode: { value: string; result: string }
    }
    expect(card.token).toBe(SHIFT4_REDACTED)
    expect(card.securityCode.value).toBe(SHIFT4_REDACTED)
    // Verification RESULTS are certification evidence and must survive.
    expect(card.securityCode.result).toBe("M")
    expect((redacted.transaction as unknown as { responseCode: string }).responseCode).toBe("A")
  })

  it("masks card-number-shaped digit runs in a non-JSON body summary", () => {
    const summary = shift4SafeBodySummary("upstream error for card 4111111111111111 at gateway")
    expect(summary).not.toContain("4111111111111111")
    expect(summary).toContain(SHIFT4_REDACTED)
  })

  it("detects a leaked secret in arbitrary text", () => {
    expect(containsShift4Secret(`token=${FAKE_ACCESS_TOKEN}`, [FAKE_ACCESS_TOKEN])).toBe(true)
    expect(containsShift4Secret("nothing sensitive", [FAKE_ACCESS_TOKEN])).toBe(false)
  })
})

/* ── Access token exchange ───────────────────────────────────────────────── */

describe("Shift4 access token exchange", () => {
  const successBody = {
    result: [
      {
        dateTime: "2026-07-30T09:18:23.283-07:00",
        credential: { accessToken: FAKE_ACCESS_TOKEN },
        server: { name: "TM01CE" },
      },
    ],
  }

  it("sends the documented request body and returns a normalized result", async () => {
    const fetchImpl = fetchReturning(jsonResponse(successBody))

    const outcome = await exchangeAccessToken({
      authToken: FAKE_AUTH_TOKEN,
      config: testConfig(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(outcome.accessToken).toBe(FAKE_ACCESS_TOKEN)
    expect(outcome.auditableResult.serverName).toBe("TM01CE")
    expect(outcome.auditableResult.accessTokenFingerprint).toHaveLength(12)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${SHIFT4_REST_TEST_BASE_URL}/credentials/accesstoken`)
    expect(init.method).toBe("POST")

    const body = JSON.parse(String(init.body)) as {
      dateTime: string
      credential: { authToken: string; clientGuid: string }
    }
    expect(body.credential.authToken).toBe(FAKE_AUTH_TOKEN)
    expect(body.credential.clientGuid).toBe(FAKE_CLIENT_GUID)
    // ISO 8601 with an explicit offset, not a UTC "Z" instant.
    expect(body.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })

  it("never returns the auth token and never logs either credential", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const outcome = await exchangeAccessToken({
      authToken: FAKE_AUTH_TOKEN,
      config: testConfig(),
      fetchImpl: fetchReturning(jsonResponse(successBody)) as unknown as typeof fetch,
    })

    const serializedOutcome = JSON.stringify(outcome.auditableResult)
    expect(serializedOutcome).not.toContain(FAKE_AUTH_TOKEN)
    expect(serializedOutcome).not.toContain(FAKE_ACCESS_TOKEN)

    const logged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls])
    expect(logged).not.toContain(FAKE_AUTH_TOKEN)
    expect(logged).not.toContain(FAKE_ACCESS_TOKEN)
    expect(logged).not.toContain(FAKE_CLIENT_GUID)
  })

  it("rejects a malformed response that carries no accessToken", async () => {
    const malformed = { result: [{ dateTime: "2026-07-30T09:18:23.283-07:00", credential: {} }] }

    await expect(
      exchangeAccessToken({
        authToken: FAKE_AUTH_TOKEN,
        config: testConfig(),
        fetchImpl: fetchReturning(jsonResponse(malformed)) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Shift4RestInvalidResponseError)
  })

  it("rejects a response outside the documented envelope", async () => {
    const notAnEnvelope = { accessToken: FAKE_ACCESS_TOKEN }

    await expect(
      exchangeAccessToken({
        authToken: FAKE_AUTH_TOKEN,
        config: testConfig(),
        fetchImpl: fetchReturning(jsonResponse(notAnEnvelope)) as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(Shift4RestInvalidResponseError)
  })

  it("surfaces a structured exchange failure without leaking the auth token", async () => {
    const rejection = {
      result: [
        {
          error: {
            code: 64100,
            severity: "Info",
            shortText: "Auth Token Invalid",
            longText: "The supplied auth token is not valid.",
            primaryCode: 6,
            secondaryCode: 41,
          },
          server: { name: "TM01CE" },
        },
      ],
    }

    const error = await exchangeAccessToken({
      authToken: FAKE_AUTH_TOKEN,
      config: testConfig(),
      fetchImpl: fetchReturning(jsonResponse(rejection, 400)) as unknown as typeof fetch,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Shift4RestApiError)
    const apiError = error as Shift4RestApiError
    expect(apiError.shortText).toBe("Auth Token Invalid")
    expect(apiError.primaryCode).toBe(6)
    expect(JSON.stringify(describeShift4Error(apiError))).not.toContain(FAKE_AUTH_TOKEN)
  })

  it("formats the merchant local date/time with a real offset", () => {
    const formatted = formatShift4DateTime(new Date("2026-07-30T16:18:23.283Z"), "America/Los_Angeles")
    expect(formatted).toBe("2026-07-30T09:18:23.283-07:00")
  })
})

/* ── Duplicate / concurrent exchange protection ──────────────────────────── */

describe("Shift4 exchange duplicate protection", () => {
  const claimApiIdempotency = vi.fn()
  const completeApiIdempotencyClaim = vi.fn()
  const releaseApiIdempotencyClaim = vi.fn()
  const saveShift4RestConnection = vi.fn()
  const exchangeAccessTokenMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    claimApiIdempotency.mockReset()
    completeApiIdempotencyClaim.mockReset()
    releaseApiIdempotencyClaim.mockReset()
    saveShift4RestConnection.mockReset()
    // Default to a failing exchange. The provider module is always mocked so no
    // test in this file can reach Shift4 over the network.
    exchangeAccessTokenMock.mockReset()
    exchangeAccessTokenMock.mockRejectedValue(new Error("exchange unavailable in test"))

    vi.doMock("@/providers/shift4/rest/credentials/exchangeAccessToken", () => ({
      exchangeAccessToken: exchangeAccessTokenMock,
    }))
    vi.doMock("@/database/apiIdempotencyClaims", () => ({
      claimApiIdempotency,
      completeApiIdempotencyClaim,
      releaseApiIdempotencyClaim,
    }))
    vi.doMock("@/database/merchantShift4RestConnections", () => ({
      SHIFT4_REST_PROVIDER_NAME: "shift4_rest",
      isShift4RestConnectionChannel: (value: unknown) =>
        value === "retail" || value === "ecommerce",
      saveShift4RestConnection,
      getShift4RestConnectionStatus: vi.fn(),
      clearShift4RestCredential: vi.fn(),
    }))
    vi.stubEnv("SHIFT4_REST_ENVIRONMENT", "test")
    vi.stubEnv("SHIFT4_INTERFACE_NAME", TEST_IDENTITY.interfaceName)
    vi.stubEnv("SHIFT4_INTERFACE_VERSION", TEST_IDENTITY.interfaceVersion)
    vi.stubEnv("SHIFT4_COMPANY_NAME", TEST_IDENTITY.companyName)
  })

  afterEach(() => {
    vi.doUnmock("@/providers/shift4/rest/credentials/exchangeAccessToken")
    vi.doUnmock("@/database/apiIdempotencyClaims")
    vi.doUnmock("@/database/merchantShift4RestConnections")
    vi.resetModules()
  })

  it("rejects a concurrent exchange that loses the claim race", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: false,
      claim: { id: "claim-1", resource_id: null },
    })

    const { connectShift4Merchant, Shift4ConnectionError } = await import("@/engine/shift4Connection")

    const error = await connectShift4Merchant({
      merchantId: "merchant-1",
      authToken: FAKE_AUTH_TOKEN,
      channel: "retail",
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Shift4ConnectionError)
    expect((error as { code: string }).code).toBe("exchange_in_progress")
    expect(saveShift4RestConnection).not.toHaveBeenCalled()
  })

  it("rejects reuse of an auth token that was already exchanged", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: false,
      claim: { id: "claim-1", resource_id: "connection-1" },
    })

    const { connectShift4Merchant } = await import("@/engine/shift4Connection")

    const error = await connectShift4Merchant({
      merchantId: "merchant-1",
      authToken: FAKE_AUTH_TOKEN,
      channel: "retail",
    }).catch((caught: unknown) => caught)

    expect((error as { code: string }).code).toBe("auth_token_already_used")
    expect(saveShift4RestConnection).not.toHaveBeenCalled()
  })

  it("keys the duplicate guard on the auth token hash, never the token", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: false,
      claim: { id: "claim-1", resource_id: null },
    })

    const { connectShift4Merchant } = await import("@/engine/shift4Connection")
    await connectShift4Merchant({ merchantId: "merchant-1", authToken: FAKE_AUTH_TOKEN, channel: "retail" })
      .catch(() => undefined)

    const claimArgs = claimApiIdempotency.mock.calls[0][0] as { keyHash: string }
    expect(claimArgs.keyHash).toHaveLength(64)
    expect(claimArgs.keyHash).not.toContain(FAKE_AUTH_TOKEN)
  })

  it("releases the claim when the exchange fails so a new token can be used", async () => {
    claimApiIdempotency.mockResolvedValue({
      claimed: true,
      claim: { id: "claim-1", resource_id: null },
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const { connectShift4Merchant } = await import("@/engine/shift4Connection")

    // The mocked provider exchange rejects; no network call is made.
    await connectShift4Merchant({ merchantId: "merchant-1", authToken: FAKE_AUTH_TOKEN, channel: "retail" })
      .catch(() => undefined)

    expect(exchangeAccessTokenMock).toHaveBeenCalledTimes(1)
    expect(releaseApiIdempotencyClaim).toHaveBeenCalledWith("claim-1")
    expect(completeApiIdempotencyClaim).not.toHaveBeenCalled()
  })

  it("encrypts the access token before persisting a successful exchange", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    claimApiIdempotency.mockResolvedValue({
      claimed: true,
      claim: { id: "claim-1", resource_id: null },
    })
    saveShift4RestConnection.mockResolvedValue({ connectionId: "connection-1" })
    exchangeAccessTokenMock.mockResolvedValue({
      accessToken: FAKE_ACCESS_TOKEN,
      auditableResult: {
        exchangedAt: "2026-07-30T00:00:01.000Z",
        providerDateTime: "2026-07-30T09:18:23.283-07:00",
        serverName: "TM01CE",
        environment: "test",
        interfaceName: TEST_IDENTITY.interfaceName,
        interfaceVersion: TEST_IDENTITY.interfaceVersion,
        companyName: TEST_IDENTITY.companyName,
        correlationId: "corr-exchange",
        accessTokenFingerprint: "abcdef123456",
      },
    })

    const { connectShift4Merchant } = await import("@/engine/shift4Connection")
    const result = await connectShift4Merchant({
      merchantId: "merchant-1",
      authToken: FAKE_AUTH_TOKEN,
      channel: "retail",
    })

    expect(result.connectionId).toBe("connection-1")
    expect(result.exchanged).toBe(true)

    // The token reaches persistence only as an encrypted envelope.
    const saved = saveShift4RestConnection.mock.calls[0][0] as {
      encryptedAccessToken: unknown
    }
    expect(isShift4EncryptedSecret(saved.encryptedAccessToken)).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(FAKE_ACCESS_TOKEN)

    // The idempotency record holds no secret either.
    const completed = completeApiIdempotencyClaim.mock.calls[0][0] as unknown
    expect(JSON.stringify(completed)).not.toContain(FAKE_ACCESS_TOKEN)
    expect(JSON.stringify(completed)).not.toContain(FAKE_AUTH_TOKEN)

    // The returned result is safe to serialize to an authenticated caller.
    expect(JSON.stringify(result)).not.toContain(FAKE_ACCESS_TOKEN)
    expect(JSON.stringify(result)).not.toContain(FAKE_AUTH_TOKEN)
  })
})

/* ── Credential encryption ───────────────────────────────────────────────── */

describe("Shift4 access token encryption", () => {
  it("round-trips the access token through the AES-256-GCM envelope", () => {
    const envelope = encryptShift4AccessToken(FAKE_ACCESS_TOKEN)

    expect(isShift4EncryptedSecret(envelope)).toBe(true)
    expect(JSON.stringify(envelope)).not.toContain(FAKE_ACCESS_TOKEN)
    expect(decryptShift4AccessToken(envelope)).toBe(FAKE_ACCESS_TOKEN)
  })

  it("produces a different ciphertext each time", () => {
    const first = encryptShift4AccessToken(FAKE_ACCESS_TOKEN)
    const second = encryptShift4AccessToken(FAKE_ACCESS_TOKEN)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.iv).not.toBe(second.iv)
  })

  it("fails when the stored envelope was tampered with", () => {
    const envelope = encryptShift4AccessToken(FAKE_ACCESS_TOKEN)
    const tampered = { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") }
    expect(() => decryptShift4AccessToken(tampered)).toThrow(/could not be decrypted/i)
  })

  it("refuses to operate without a valid 32-byte key", () => {
    vi.stubEnv("SHIFT4_CREDENTIAL_ENCRYPTION_KEY", "too-short")
    expect(() => encryptShift4AccessToken(FAKE_ACCESS_TOKEN)).toThrow(/64-char hex/i)
  })
})

/* ── Normalized results ──────────────────────────────────────────────────── */

describe("Shift4 normalized results", () => {
  const timing = {
    requestStartedAt: new Date("2026-07-30T00:00:00.000Z"),
    requestCompletedAt: new Date("2026-07-30T00:00:01.500Z"),
  }

  it("normalizes an approval without inferring a PineTree status", () => {
    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "corr-1",
      httpStatus: 200,
      body: approvedSaleBody(),
      ...timing,
    })

    expect(result.outcome).toBe("approved")
    expect(result.requiresInvoiceResolution).toBe(false)
    expect(result.responseCode).toBe("A")
    expect(result.invoice).toBe("1234567890")
    expect(result.authorizationCode).toBe("OK1234")
    expect(result.retrievalReference).toBe("REF123456789")
    expect(result.avsResult).toBe("Y")
    expect(result.cscResult).toBe("M")
    expect(result.entryChannel).toBe("ecommerce")
    expect(result.approvedAmountMinor).toBe(2550)
    expect(result.elapsedMs).toBe(1500)
    expect(result.cardTokenValue).toBe("TOKEN00000000001")

    // Provider evidence only - no canonical PineTree status is produced.
    expect(Object.values(result)).not.toContain("CONFIRMED")
  })

  it("rejects malformed approved totals instead of rounding or parsing loosely", () => {
    for (const malformed of ["1e2", "-1.00", "1.001", "90071992547409.92"]) {
      const body = approvedSaleBody()
      body.result[0].amount.total = malformed as unknown as number
      const result = normalizeShift4Response({
        operation: "sale",
        correlationId: `malformed-${malformed}`,
        httpStatus: 200,
        body,
        ...timing,
      })
      expect(result.approvedAmountMinor, malformed).toBeNull()
      expect(result.outcome, malformed).toBe("unknown")
      expect(result.requiresInvoiceResolution, malformed).toBe(true)
    }
  })

  it("normalizes amount-inconsistent approval evidence before it reaches the Engine", () => {
    for (const code of ["A", "C"] as const) {
      const body = approvedSaleBody()
      body.result[0].transaction.responseCode = code
      body.result[0].amount.total = 10
      const result = normalizeShift4Response({
        operation: "sale",
        correlationId: `short-${code}`,
        requestedAmountMinor: 2550,
        httpStatus: 200,
        body,
        ...timing,
      })
      expect(result.outcome).toBe("inconsistent_approval")
      expect(result.requiresInvoiceResolution).toBe(false)
    }

    const partial = approvedSaleBody()
    partial.result[0].transaction.responseCode = "P"
    partial.result[0].amount.total = 25.5
    expect(normalizeShift4Response({
      operation: "sale",
      correlationId: "invalid-partial",
      requestedAmountMinor: 2550,
      httpStatus: 200,
      body: partial,
      ...timing,
    }).outcome).toBe("inconsistent_approval")
  })

  it("requires invoice resolution when approval amount evidence is absent", () => {
    const body = approvedSaleBody()
    body.result[0].amount = {} as typeof body.result[0]["amount"]
    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "missing-approved-total",
      requestedAmountMinor: 2550,
      httpStatus: 200,
      body,
      ...timing,
    })
    expect(result.outcome).toBe("unknown")
    expect(result.requiresInvoiceResolution).toBe(true)
  })

  it("normalizes a decline", () => {
    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "corr-2",
      httpStatus: 200,
      body: declinedSaleBody(),
      ...timing,
    })

    expect(result.outcome).toBe("declined")
    expect(result.responseCode).toBe("D")
    expect(result.requiresInvoiceResolution).toBe(false)
  })

  it("treats a blank response code as unknown, never as approved or failed", () => {
    const body = approvedSaleBody()
    body.result[0].transaction.responseCode = ""

    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "corr-3",
      httpStatus: 200,
      body,
      ...timing,
    })

    expect(result.outcome).toBe("unknown")
    expect(result.requiresInvoiceResolution).toBe(true)
  })

  it("does not treat an HTTP 200 alone as an approval for a money-moving operation", () => {
    // Regression guard. This previously classified as "approved" purely because
    // the transport succeeded, which would let the Engine confirm a payment that
    // Shift4 never reported a response code for.
    for (const operation of ["sale", "authorization", "capture", "refund"] as const) {
      const result = normalizeShift4Response({
        operation,
        correlationId: "corr-200",
        httpStatus: 200,
        body: { result: [{ dateTime: "2026-07-30T09:18:23.283-07:00" }] },
        ...timing,
      })
      expect(result.outcome, `${operation} with no responseCode`).toBe("unknown")
      expect(result.requiresInvoiceResolution).toBe(true)
    }
  })

  it("does not treat an HTTP 200 alone as authoritative for invoice lookup or void", () => {
    for (const operation of ["invoice_information", "void"] as const) {
      const result = normalizeShift4Response({
        operation,
        correlationId: "corr-200b",
        httpStatus: 200,
        body: { result: [{}] },
        ...timing,
      })
      expect(result.outcome, operation).toBe("unknown")
    }
  })

  it("still lets the access-token exchange succeed without a transaction response code", () => {
    const result = normalizeShift4Response({
      operation: "access_token_exchange",
      correlationId: "corr-200c",
      httpStatus: 200,
      body: { result: [{ credential: { accessToken: FAKE_ACCESS_TOKEN } }] },
      ...timing,
    })

    expect(result.outcome).toBe("approved")
    // The token itself must not survive into the normalized result.
    expect(JSON.stringify(result)).not.toContain(FAKE_ACCESS_TOKEN)
  })

  it("treats an undocumented response code as unknown", () => {
    const body = approvedSaleBody()
    body.result[0].transaction.responseCode = "Z"

    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "corr-4",
      httpStatus: 200,
      body,
      ...timing,
    })

    expect(result.outcome).toBe("unknown")
  })

  it("maps partial approval, referral, and AVS/CSC failure distinctly", () => {
    const cases: [string, string][] = [
      ["P", "partial_approval"],
      ["R", "referral"],
      ["f", "verification_failed"],
      ["e", "provider_error"],
      ["X", "provider_error"],
      ["S", "authentication_required"],
      ["J", "soft_declined"],
    ]

    for (const [code, expected] of cases) {
      const body = approvedSaleBody()
      body.result[0].transaction.responseCode = code
      const result = normalizeShift4Response({
        operation: "sale",
        correlationId: "corr-5",
        httpStatus: 200,
        body,
        ...timing,
      })
      expect(result.outcome, `responseCode ${code}`).toBe(expected)
    }
  })

  it("keeps a raw response reference without retaining the raw payload", () => {
    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "corr-6",
      httpStatus: 200,
      body: approvedSaleBody(),
      ...timing,
    })

    expect(result.rawResponseRef).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(result.redactedResponse)).not.toContain("TOKEN00000000001")
  })

  it("excludes the card token from the log-safe projection", () => {
    const result = normalizeShift4Response({
      operation: "sale",
      correlationId: "corr-7",
      httpStatus: 200,
      body: approvedSaleBody(),
      ...timing,
    })

    const logged = JSON.stringify(shift4ResultForLog(result))
    expect(logged).not.toContain("TOKEN00000000001")
    expect(logged).not.toContain("OK1234")
    expect(logged).toContain("\"responseCode\":\"A\"")
    expect(logged).toContain("\"avsResult\":\"Y\"")
  })
})

/* ── Timeout and communication failure classification ────────────────────── */

describe("Shift4 timeout and communication failure classification", () => {
  it("lists the documented communication error codes", () => {
    expect(SHIFT4_COMMUNICATION_ERROR_CODES).toContain(9012)
    expect(SHIFT4_COMMUNICATION_ERROR_CODES).toContain(1001)
    expect(SHIFT4_COMMUNICATION_ERROR_CODES).toContain(9978)
    expect(isShift4CommunicationErrorCode(9501)).toBe(false)
  })

  it("classifies an aborted request as an unknown outcome, not a failure", async () => {
    const abortingFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const error = await shift4RestRequest({
      operation: "sale",
      accessToken: FAKE_ACCESS_TOKEN,
      body: { any: "body" },
      config: testConfig(),
      timeoutMs: 5,
      fetchImpl: abortingFetch as unknown as typeof fetch,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Shift4RestTransportError)
    const transportError = error as Shift4RestTransportError
    expect(transportError.timedOut).toBe(true)
    expect(transportError.outcomeUncertain).toBe(true)
    expect(isShift4UnknownOutcomeError(transportError)).toBe(true)
  })

  it("maps every documented communication error code to an unknown outcome", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    for (const code of SHIFT4_COMMUNICATION_ERROR_CODES) {
      const error = await shift4RestRequest({
        operation: "sale",
        accessToken: FAKE_ACCESS_TOKEN,
        body: { any: "body" },
        config: testConfig(),
        fetchImpl: fetchReturning(jsonResponse(errorBody(code), 400)) as unknown as typeof fetch,
      }).catch((caught: unknown) => caught)

      expect(error, `code ${code}`).toBeInstanceOf(Shift4RestApiError)
      expect((error as Shift4RestApiError).communicationFailure, `code ${code}`).toBe(true)
      expect(isShift4UnknownOutcomeError(error), `code ${code}`).toBe(true)
    }
  })

  it("classifies a documented communication error code as an unknown outcome", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const error = await shift4RestRequest({
      operation: "sale",
      accessToken: FAKE_ACCESS_TOKEN,
      body: { any: "body" },
      config: testConfig(),
      fetchImpl: fetchReturning(jsonResponse(errorBody(9012), 400)) as unknown as typeof fetch,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Shift4RestApiError)
    const apiError = error as Shift4RestApiError
    expect(apiError.communicationFailure).toBe(true)
    expect(isShift4UnknownOutcomeError(apiError)).toBe(true)
  })

  it("does not treat an ordinary provider error as an unknown outcome", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})

    const response = await shift4RestRequest({
      operation: "sale",
      accessToken: FAKE_ACCESS_TOKEN,
      body: { any: "body" },
      config: testConfig(),
      fetchImpl: fetchReturning(
        jsonResponse(errorBody(64100, "Invalid Data", "Field is invalid"), 400)
      ) as unknown as typeof fetch,
    })

    expect(response.result.outcome).toBe("provider_error")
    expect(response.result.requiresInvoiceResolution).toBe(false)
  })

  it("classifies a malformed provider response as unknown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const malformed = {
      status: 200,
      ok: true,
      text: async () => "<html>gateway error</html>",
    } as unknown as Response

    const error = await shift4RestRequest({
      operation: "sale",
      accessToken: FAKE_ACCESS_TOKEN,
      body: { any: "body" },
      config: testConfig(),
      fetchImpl: fetchReturning(malformed) as unknown as typeof fetch,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Shift4RestInvalidResponseError)
    expect(isShift4UnknownOutcomeError(error)).toBe(true)
  })

  it("never retries a transaction-creating operation automatically", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchImpl = fetchReturning(jsonResponse(errorBody(9012), 400))

    await shift4RestRequest({
      operation: "sale",
      accessToken: FAKE_ACCESS_TOKEN,
      body: { any: "body" },
      config: testConfig(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch(() => undefined)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("keeps secrets out of a thrown transport error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const error = await shift4RestRequest({
      operation: "sale",
      accessToken: FAKE_ACCESS_TOKEN,
      body: { any: "body" },
      config: testConfig(),
      fetchImpl: (() => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch,
    }).catch((caught: unknown) => caught)

    const serialized = JSON.stringify({
      message: (error as Error).message,
      described: describeShift4Error(error),
    })
    expect(serialized).not.toContain(FAKE_ACCESS_TOKEN)
    expect(serialized).not.toContain(FAKE_CLIENT_GUID)
  })
})

/* ── Invoice lookup and void ─────────────────────────────────────────────── */

describe("Shift4 invoice lookup and void", () => {
  it("reports Invoice Not Found as the only resend-permitted condition", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const notFound = jsonResponse(
      errorBody(9999, "Invoice Not Found", "Invoice Not Found for the supplied invoice"),
      400
    )

    const lookup = await getInvoice({
      invoice: "1234567890",
      accessToken: FAKE_ACCESS_TOKEN,
      config: testConfig(),
      fetchImpl: fetchReturning(notFound) as unknown as typeof fetch,
    })

    expect(lookup.found).toBe(false)
    if (!lookup.found) {
      expect(lookup.condition).toBe("invoice_not_found")
      // The provider reports only what Shift4 observed. It must NOT hand the
      // caller a "safe to resend" flag: Shift4 returns the same text for a
      // voided or already settled invoice, so resending on this alone could
      // double-charge. Resend eligibility is an Engine decision.
      expect(lookup).not.toHaveProperty("resendPermitted")
    }
  })

  it("returns authoritative evidence when the invoice exists", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})

    const lookup = await getInvoice({
      invoice: "1234567890",
      accessToken: FAKE_ACCESS_TOKEN,
      config: testConfig(),
      fetchImpl: fetchReturning(jsonResponse(approvedSaleBody())) as unknown as typeof fetch,
    })

    expect(lookup.found).toBe(true)
    if (lookup.found) {
      expect(lookup.result.outcome).toBe("approved")
      expect(lookup.result.invoice).toBe("1234567890")
    }
  })

  it("retries a failed lookup exactly once, as the guide permits", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})

    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error("socket hang up")
      return jsonResponse(approvedSaleBody())
    })

    const lookup = await getInvoice({
      invoice: "1234567890",
      accessToken: FAKE_ACCESS_TOKEN,
      config: testConfig(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(lookup.found).toBe(true)
  })

  it("refuses a void without an explicit permitted reason", async () => {
    await expect(
      voidInvoice({
        invoice: "1234567890",
        accessToken: FAKE_ACCESS_TOKEN,
        // Shift4 forbids voiding a failed transaction; no such reason exists.
        reason: "timeout" as unknown as "merchant_initiated",
        config: testConfig(),
        fetchImpl: fetchReturning(jsonResponse(approvedSaleBody())) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/explicit permitted reason/i)
  })
})

/* ── Invoice correlation ─────────────────────────────────────────────────── */

describe("Shift4 invoice correlation", () => {
  const base = {
    merchantProviderConnectionId: "connection-1",
    pineTreePaymentId: "payment-1",
    pineTreePaymentAttemptId: "attempt-1",
  }

  it("fits the documented 10-character invoice limit", () => {
    const reference = createInvoiceReference(base)
    expect(reference.invoice).toHaveLength(10)
    expect(reference.invoice).toMatch(/^\d{10}$/)
    expect(() => assertValidShift4Invoice(reference.invoice)).not.toThrow()
  })

  it("is stable for the same attempt, so timeout recovery reuses one invoice", () => {
    expect(createInvoiceReference(base).invoice).toBe(createInvoiceReference(base).invoice)
  })

  it("separates different attempts on the same payment", () => {
    const first = createInvoiceReference(base)
    const second = createInvoiceReference({ ...base, pineTreePaymentAttemptId: "attempt-2" })
    expect(second.invoice).not.toBe(first.invoice)
  })

  it("separates different payments and different merchant connections", () => {
    const first = createInvoiceReference(base)
    expect(createInvoiceReference({ ...base, pineTreePaymentId: "payment-2" }).invoice)
      .not.toBe(first.invoice)
    expect(createInvoiceReference({ ...base, merchantProviderConnectionId: "connection-2" }).invoice)
      .not.toBe(first.invoice)
  })

  it("gives a refund its own invoice, which Shift4 requires", () => {
    const payment = createInvoiceReference(base)
    const refundReference = createInvoiceReference({
      ...base,
      purpose: "refund",
      refundId: "refund-1",
    })

    expect(refundReference.purpose).toBe("refund")
    expect(refundReference.invoice).not.toBe(payment.invoice)

    const secondRefund = createInvoiceReference({
      ...base,
      purpose: "refund",
      refundId: "refund-2",
    })
    expect(secondRefund.invoice).not.toBe(refundReference.invoice)
  })

  it("requires a refund identifier so two refunds cannot collide", () => {
    expect(() => createInvoiceReference({ ...base, purpose: "refund" })).toThrow(/refundId/)
  })

  it("does not derive an invoice from incomplete identity", () => {
    expect(() => createInvoiceReference({ ...base, pineTreePaymentAttemptId: "" }))
      .toThrow(/pineTreePaymentAttemptId/)
  })

  it("confirms the invoice Shift4 echoes belongs to this attempt", () => {
    const reference = createInvoiceReference(base)
    expect(invoiceMatchesReference(reference, reference.invoice)).toBe(true)
    expect(invoiceMatchesReference(reference, "9999999999")).toBe(false)
    expect(invoiceMatchesReference(reference, null)).toBe(false)
  })

  it("rejects an invoice longer than the documented maximum", () => {
    expect(() => assertValidShift4Invoice("12345678901")).toThrow(/at most 10/i)
  })
})

/* ── Transaction wrappers ────────────────────────────────────────────────── */

describe("Shift4 minor-unit serialization", () => {
  it.each([
    [1, 0.01],
    [15, 0.15],
    [11161, 111.61],
    [21900, 219],
    [99999801, 999998.01],
  ])("serializes %i minor units as %d", (amountMinor, expected) => {
    expect(minorUnitsToShift4Amount(amountMinor, "USD")).toBe(expected)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid transaction total %s",
    (amountMinor) => {
      expect(() => minorUnitsToShift4Amount(amountMinor, "USD")).toThrow()
    }
  )

  it("rejects unsupported currencies while allowing an explicit zero component", () => {
    expect(() => minorUnitsToShift4Amount(100, "EUR")).toThrow(/USD and CAD/)
    expect(minorUnitsToShift4Amount(0, "CAD", { allowZero: true })).toBe(0)
  })
})

describe("Shift4 transaction wrappers", () => {
  const requestBase = {
    invoice: "1234567890",
    amountMinor: 2550,
    taxAmountMinor: 0,
    clerkNumericId: 1,
    card: { tokenValue: "TOKEN00000000001" },
    accessToken: FAKE_ACCESS_TOKEN,
    config: testConfig(),
  }

  it("builds the documented tokenized request body", () => {
    const body = buildTokenTransactionRequest("sale", requestBase)

    expect(body.transaction.invoice).toBe("1234567890")
    expect(body.card.token.value).toBe("TOKEN00000000001")
    expect(body.amount.total).toBe(25.5)
    expect(body.amount.tax).toBe(0)
    expect(body.clerk.numericId).toBe(1)
    // PineTree never sends raw card data.
    expect(body.card).not.toHaveProperty("number")
  })

  it("posts a sale to the documented endpoint with the required headers", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const fetchImpl = fetchReturning(jsonResponse(approvedSaleBody()))

    const result = await sale({
      ...requestBase,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${SHIFT4_REST_TEST_BASE_URL}/transactions/sale`)
    expect((init.headers as Record<string, string>).AccessToken).toBe(FAKE_ACCESS_TOKEN)
    expect(result.outcome).toBe("approved")
  })

  it("refuses a transaction with no tokenized card", async () => {
    await expect(
      sale({ ...requestBase, card: { tokenValue: "" } })
    ).rejects.toThrow(/tokenized card/i)
  })

  it("refuses a refund that reuses the sale invoice", async () => {
    const paymentReference = createInvoiceReference({
      merchantProviderConnectionId: "connection-1",
      pineTreePaymentId: "payment-1",
      pineTreePaymentAttemptId: "attempt-1",
    })

    await expect(
      refund({
        ...requestBase,
        invoice: paymentReference.invoice,
        refundInvoiceReference: paymentReference,
      })
    ).rejects.toThrow(/purpose "refund"/)
  })

  it("accepts a refund that carries its own derived invoice", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const refundReference = createInvoiceReference({
      merchantProviderConnectionId: "connection-1",
      pineTreePaymentId: "payment-1",
      pineTreePaymentAttemptId: "attempt-1",
      purpose: "refund",
      refundId: "refund-1",
    })

    const result = await refund({
      ...requestBase,
      invoice: refundReference.invoice,
      refundInvoiceReference: refundReference,
      fetchImpl: fetchReturning(
        jsonResponse(approvedSaleBody(refundReference.invoice))
      ) as unknown as typeof fetch,
    })

    expect(result.outcome).toBe("approved")
    expect(result.invoice).toBe(refundReference.invoice)
  })
})

/* ── Provider-key isolation and browser boundary ─────────────────────────── */

describe("Shift4 REST provider isolation", () => {
  it("cannot be normalized into a customer-facing payment adapter or network", async () => {
    const { normalizePaymentAdapter, normalizePaymentNetwork } = await import("@/types/payment")
    const { SHIFT4_REST_PROVIDER_NAME } = await import("@/database/merchantShift4RestConnections")

    // The internal REST connection key must never resolve to a routable adapter
    // or a customer-facing rail, or a connection row would become a payment
    // option before any payment path exists.
    expect(normalizePaymentAdapter(SHIFT4_REST_PROVIDER_NAME)).toBeUndefined()
    expect(normalizePaymentNetwork(SHIFT4_REST_PROVIDER_NAME)).toBeNull()

    // The legacy customer-facing Shift4 provider is untouched by this phase.
    expect(normalizePaymentAdapter("shift4")).toBe("shift4")
  })

  it("filters the raw shift4_rest row out of the dashboard provider response", async () => {
    const fs = await import("fs")
    const path = await import("path")
    const source = fs.readFileSync(
      path.join(process.cwd(), "engine", "providersDashboard.ts"),
      "utf8"
    )

    // decorateProviderRows passes unknown provider rows through verbatim, so the
    // Shift4 REST row - which carries the encrypted access-token envelope - must
    // be excluded before serialization.
    expect(source).toContain("SHIFT4_REST_PROVIDER_NAME")
    expect(source).toContain("row.provider !== SHIFT4_REST_PROVIDER_NAME")
  })

  it("keeps encrypted credential fields out of anything the dashboard serializes", async () => {
    const { encryptShift4AccessToken } = await import(
      "@/providers/shift4/rest/credentials/secretEnvelope"
    )
    const { SHIFT4_REST_PROVIDER_NAME } = await import("@/database/merchantShift4RestConnections")

    const envelope = encryptShift4AccessToken(FAKE_ACCESS_TOKEN)
    const rows = [
      { provider: "stripe", credentials: { stripe_account_id: "acct_1" } },
      {
        provider: SHIFT4_REST_PROVIDER_NAME,
        credentials: { access_token: envelope, access_token_fingerprint: "abcdef123456" },
      },
    ]

    // Mirror the dashboard's exclusion rule and prove the ciphertext, IV, and
    // auth tag cannot survive into a serialized response.
    const serialized = JSON.stringify(
      rows.filter((row) => row.provider !== SHIFT4_REST_PROVIDER_NAME)
    )

    expect(serialized).not.toContain(envelope.ciphertext)
    expect(serialized).not.toContain(envelope.iv)
    expect(serialized).not.toContain(envelope.authTag)
    expect(serialized).not.toContain("access_token")
    expect(serialized).toContain("acct_1")
  })

  it("is never imported by browser-facing code", async () => {
    const fs = await import("fs")
    const path = await import("path")

    const roots = ["app", "components", "packages"]
    const offenders: string[] = []

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (fs.readFileSync(full, "utf8").includes("shift4/rest")) offenders.push(full)
      }
    }

    for (const root of roots) walk(path.join(process.cwd(), root))

    // The Shift4 REST module is server-only: it reads credentials and speaks to
    // a live gateway. A browser bundle must never be able to reach it.
    expect(offenders).toEqual([])
  })
})
