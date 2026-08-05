/**
 * Bridge (by Stripe) - configuration, client, and redaction contract.
 *
 * All Bridge identifiers and payloads here are fully fabricated. No real
 * customer information appears in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  BRIDGE_PRODUCTION_BASE_URL,
  BRIDGE_SANDBOX_BASE_URL,
  BridgeConfigError,
  bridgeBaseUrlForEnvironment,
  describeBridgeConfiguration,
  getBridgeConfig,
  getBridgeWebhookPublicKey,
  isBridgeConfigured,
  resolveBridgeEnvironment,
  validateBridgeBaseUrl,
} from "@/providers/bridge/config"
import {
  assertUsableIdempotencyKey,
  bridgeRequest,
  buildBridgeHeaders,
  createKycLink,
  createWebhook,
  fetchWebhookDetails,
  getCustomer,
  getKycLink,
} from "@/providers/bridge/client"
import {
  BridgeApiError,
  BridgeInvalidResponseError,
  BridgeTransportError,
  isBridgeRetryableError,
  isBridgeUnknownOutcomeError,
} from "@/providers/bridge/errors"
import {
  bridgeOnboardingIdempotencyKey,
  bridgeWebhookIdempotencyKey,
} from "@/providers/bridge/idempotency"
import {
  bridgeSafeBodySummary,
  containsBridgeSecret,
  redactBridgeHeaders,
  redactBridgePayload,
} from "@/providers/bridge/redact"
import {
  assertBridgeDecimalAmount,
  bridgeDecimalFromMinorUnits,
  bridgeMinorUnitsFromDecimal,
} from "@/providers/bridge/money"

const FAKE_API_KEY = "sk_test_bridgefake0000000000000000"
const FAKE_REDIRECT = "https://app.pinetree.test/dashboard/providers?provider=bridge"

const TEST_CONFIG = {
  environment: "sandbox" as const,
  baseUrl: BRIDGE_SANDBOX_BASE_URL,
  apiKey: FAKE_API_KEY,
  kycRedirectUrl: FAKE_REDIRECT,
}

/**
 * Await a promise that must reject, and return the error narrowed to the
 * expected class. Using `.catch()` directly would type the result as a union
 * with the success value, which silently allows an assertion to read a field
 * that exists on the SUCCESS shape instead of the error.
 */
async function expectRejection<T>(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => T
): Promise<T> {
  let caught: unknown
  let rejected = false
  try {
    await promise
  } catch (error) {
    caught = error
    rejected = true
  }
  expect(rejected).toBe(true)
  expect(caught).toBeInstanceOf(errorClass)
  return caught as T
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  })
}

/**
 * Only the BRIDGE_* keys this file touches are saved and restored.
 *
 * `process.env` is deliberately NOT reassigned wholesale: vitest can run
 * several test files in one worker, and replacing the object leaks a detached
 * env into unrelated suites.
 */
const BRIDGE_ENV_KEYS = [
  "BRIDGE_ENVIRONMENT",
  "BRIDGE_API_KEY",
  "BRIDGE_BASE_URL",
  "BRIDGE_WEBHOOK_PUBLIC_KEY",
  "BRIDGE_KYC_REDIRECT_URL",
  "BRIDGE_TIMEOUT_MS",
] as const

const originalBridgeEnv = new Map<string, string | undefined>(
  BRIDGE_ENV_KEYS.map((key) => [key, process.env[key]])
)

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  for (const [key, value] of originalBridgeEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("Bridge environment configuration", () => {
  it("selects the documented sandbox and production base URLs explicitly", () => {
    expect(bridgeBaseUrlForEnvironment("sandbox")).toBe("https://api.sandbox.bridge.xyz/v0")
    expect(bridgeBaseUrlForEnvironment("production")).toBe("https://api.bridge.xyz/v0")
    expect(BRIDGE_SANDBOX_BASE_URL).not.toBe(BRIDGE_PRODUCTION_BASE_URL)
  })

  it("refuses to default the environment when it is unset", () => {
    delete process.env.BRIDGE_ENVIRONMENT
    expect(() => resolveBridgeEnvironment()).toThrow(BridgeConfigError)
  })

  it("refuses an unrecognized environment rather than falling back", () => {
    expect(() => resolveBridgeEnvironment("staging")).toThrow(BridgeConfigError)
    expect(() => resolveBridgeEnvironment("")).toThrow(BridgeConfigError)
  })

  it("never lets a production deployment silently use a sandbox host", () => {
    expect(() => validateBridgeBaseUrl("https://api.sandbox.bridge.xyz/v0", "production")).toThrow(
      /sandbox host while BRIDGE_ENVIRONMENT is production/
    )
  })

  it("never lets a sandbox deployment silently use the production host", () => {
    expect(() => validateBridgeBaseUrl("https://api.bridge.xyz/v0", "sandbox")).toThrow(
      /does not point at a Bridge sandbox host/
    )
  })

  it("requires https for a base URL override", () => {
    expect(() => validateBridgeBaseUrl("http://api.sandbox.bridge.xyz/v0", "sandbox")).toThrow(/https/)
  })

  it("requires an explicit environment alongside a base URL override", () => {
    expect(() => getBridgeConfig({ baseUrl: BRIDGE_SANDBOX_BASE_URL })).toThrow(
      /requires an explicit environment/
    )
  })

  it("reports missing configuration by name instead of failing open", () => {
    process.env.BRIDGE_ENVIRONMENT = "sandbox"
    delete process.env.BRIDGE_API_KEY
    delete process.env.BRIDGE_KYC_REDIRECT_URL

    expect(() => getBridgeConfig()).toThrow(BridgeConfigError)
    try {
      getBridgeConfig()
    } catch (error) {
      expect((error as BridgeConfigError).missing).toEqual([
        "BRIDGE_API_KEY",
        "BRIDGE_KYC_REDIRECT_URL",
      ])
    }
    expect(isBridgeConfigured()).toBe(false)
  })

  it("rejects a non-https KYC redirect URL", () => {
    expect(() =>
      getBridgeConfig({
        environment: "sandbox",
        apiKey: FAKE_API_KEY,
        kycRedirectUrl: "http://evil.test/return",
      })
    ).toThrow(/must use https/)
  })

  it("requires a PEM webhook public key and restores escaped newlines", () => {
    expect(() => getBridgeWebhookPublicKey("not-a-key")).toThrow(/PEM-encoded public key/)
    const escaped = "-----BEGIN PUBLIC KEY-----\\nAAAA\\n-----END PUBLIC KEY-----"
    expect(getBridgeWebhookPublicKey(escaped)).toContain("\n")
  })

  it("summarizes configuration without exposing any secret value", () => {
    process.env.BRIDGE_ENVIRONMENT = "sandbox"
    process.env.BRIDGE_API_KEY = FAKE_API_KEY
    process.env.BRIDGE_KYC_REDIRECT_URL = FAKE_REDIRECT
    delete process.env.BRIDGE_WEBHOOK_PUBLIC_KEY

    const description = describeBridgeConfiguration()

    expect(description.environment).toBe("sandbox")
    expect(description.apiKeyConfigured).toBe(true)
    expect(description.webhookPublicKeyConfigured).toBe(false)
    expect(description.missing).toContain("BRIDGE_WEBHOOK_PUBLIC_KEY")
    expect(JSON.stringify(description)).not.toContain(FAKE_API_KEY)
  })
})

describe("Bridge API authentication and idempotency headers", () => {
  it("authenticates with the Api-Key header and never a bearer token", () => {
    const headers = buildBridgeHeaders({
      config: TEST_CONFIG,
      idempotencyKey: "pinetree.bridge.onboarding.v1.abc",
      hasBody: true,
    })

    expect(headers["Api-Key"]).toBe(FAKE_API_KEY)
    expect(headers.Authorization).toBeUndefined()
    expect(headers["Idempotency-Key"]).toBe("pinetree.bridge.onboarding.v1.abc")
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("omits the idempotency header and content type on a read", () => {
    const headers = buildBridgeHeaders({ config: TEST_CONFIG, hasBody: false })
    expect(headers["Idempotency-Key"]).toBeUndefined()
    expect(headers["Content-Type"]).toBeUndefined()
  })

  it("requires a PineTree-generated idempotency key for every mutating request", async () => {
    const fetchImpl = vi.fn()

    await expect(
      bridgeRequest({
        operation: "create_kyc_link",
        method: "POST",
        path: "/kyc_links",
        body: {},
        config: TEST_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/requires a PineTree-generated idempotency key/)

    // The request must never be dispatched without one.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects an idempotency key that could forge a header", () => {
    expect(() => assertUsableIdempotencyKey("valid-key", "create_kyc_link")).not.toThrow()
    expect(() => assertUsableIdempotencyKey("bad\r\nX-Injected: 1", "create_kyc_link")).toThrow(
      BridgeApiError
    )
  })

  it("sends the Api-Key and Idempotency-Key on a real create call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ id: "kyc_11111111-1111-4111-8111-111111111111", kyc_status: "not_started" })
    )

    await createKycLink({
      fullName: "Fake Test Business LLC",
      email: "owner@fake-merchant.test",
      type: "business",
      endorsements: ["base"],
      redirectUri: FAKE_REDIRECT,
      idempotencyKey: "pinetree.bridge.onboarding.v1.deadbeef",
      config: TEST_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>

    expect(url).toBe(`${BRIDGE_SANDBOX_BASE_URL}/kyc_links`)
    expect(headers["Api-Key"]).toBe(FAKE_API_KEY)
    expect(headers["Idempotency-Key"]).toBe("pinetree.bridge.onboarding.v1.deadbeef")
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: "business",
      endorsements: ["base"],
      redirect_uri: FAKE_REDIRECT,
    })
  })
})

describe("Bridge idempotency key derivation", () => {
  it("derives the same key for the same merchant so onboarding is never duplicated", () => {
    const first = bridgeOnboardingIdempotencyKey({ merchantId: "merchant_aaa" })
    const second = bridgeOnboardingIdempotencyKey({ merchantId: "merchant_aaa" })
    expect(first).toBe(second)
  })

  it("derives different keys for different merchants", () => {
    expect(bridgeOnboardingIdempotencyKey({ merchantId: "merchant_aaa" })).not.toBe(
      bridgeOnboardingIdempotencyKey({ merchantId: "merchant_bbb" })
    )
  })

  it("changes only when the onboarding version changes", () => {
    expect(bridgeOnboardingIdempotencyKey({ merchantId: "merchant_aaa", version: "v2" })).not.toBe(
      bridgeOnboardingIdempotencyKey({ merchantId: "merchant_aaa", version: "v1" })
    )
  })

  it("never embeds the raw merchant identifier in the outbound key", () => {
    const key = bridgeOnboardingIdempotencyKey({ merchantId: "merchant_secret_id" })
    expect(key).not.toContain("merchant_secret_id")
  })

  it("derives a stable webhook registration key per endpoint URL", () => {
    const url = "https://app.pinetree.test/api/webhooks/bridge"
    expect(bridgeWebhookIdempotencyKey({ url })).toBe(bridgeWebhookIdempotencyKey({ url }))
    expect(bridgeWebhookIdempotencyKey({ url })).not.toBe(
      bridgeWebhookIdempotencyKey({ url: "https://other.test/api/webhooks/bridge" })
    )
  })
})

describe("Bridge error classification", () => {
  it("maps a timeout to an unknown, retryable outcome rather than a failure", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    })

    const error = await expectRejection(
      bridgeRequest({
        operation: "create_kyc_link",
        method: "POST",
        path: "/kyc_links",
        body: {},
        idempotencyKey: "pinetree.bridge.onboarding.v1.timeout",
        config: TEST_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5,
      }),
      BridgeTransportError
    )

    expect(error.timedOut).toBe(true)
    // A timeout must never be recorded as a verified provider failure: Bridge
    // may already hold the customer.
    expect(error.outcomeUncertain).toBe(true)
    expect(isBridgeUnknownOutcomeError(error)).toBe(true)
    expect(isBridgeRetryableError(error)).toBe(true)
  })

  it("treats a verified 4xx rejection as a definite, non-retryable failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ code: "invalid_parameters" }, { status: 422 })
    )

    const error = await expectRejection(
      bridgeRequest({
        operation: "create_kyc_link",
        method: "POST",
        path: "/kyc_links",
        body: {},
        idempotencyKey: "pinetree.bridge.onboarding.v1.rejected",
        config: TEST_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      BridgeApiError
    )

    expect(error.httpStatus).toBe(422)
    expect(error.code).toBe("invalid_parameters")
    expect(isBridgeUnknownOutcomeError(error)).toBe(false)
    expect(isBridgeRetryableError(error)).toBe(false)
  })

  it("treats 429 and 5xx as retryable with the same idempotency key", async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status }))
      const error = await expectRejection(
        bridgeRequest({
          operation: "get_customer",
          method: "GET",
          path: "/customers/cust_fake",
          config: TEST_CONFIG,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
        BridgeApiError
      )

      expect(isBridgeRetryableError(error)).toBe(true)
    }
  })

  it("treats an unparseable 2xx body as unknown, never as success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } })
    )

    const error = await expectRejection(
      bridgeRequest({
        operation: "get_customer",
        method: "GET",
        path: "/customers/cust_fake",
        config: TEST_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      BridgeInvalidResponseError
    )

    expect(isBridgeUnknownOutcomeError(error)).toBe(true)
  })

  it("rejects a create response with no Bridge identifier", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ kyc_status: "not_started" }))

    await expect(
      createKycLink({
        fullName: "Fake Test Business LLC",
        email: "owner@fake-merchant.test",
        type: "business",
        idempotencyKey: "pinetree.bridge.onboarding.v1.noid",
        config: TEST_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(BridgeInvalidResponseError)
  })

  it("retains the provider request id for correlation when Bridge returns one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ id: "cust_22222222-2222-4222-8222-222222222222" }, {
        headers: { "x-request-id": "req_fake_9f3a" },
      })
    )

    const result = await getCustomer({
      customerId: "cust_22222222-2222-4222-8222-222222222222",
      config: TEST_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result.providerRequestId).toBe("req_fake_9f3a")
    expect(result.correlationId).toBeTruthy()
  })

  it("escapes provider identifiers so they cannot alter the request path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "kyc_fake" }))

    await getKycLink({
      kycLinkId: "../../customers/cust_other",
      config: TEST_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe(`${BRIDGE_SANDBOX_BASE_URL}/kyc_links/..%2F..%2Fcustomers%2Fcust_other`)
  })
})

describe("Bridge webhook administration helpers", () => {
  it("creates a webhook endpoint with an idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "wh_fake_1234" }))

    await createWebhook({
      url: "https://app.pinetree.test/api/webhooks/bridge",
      idempotencyKey: bridgeWebhookIdempotencyKey({
        url: "https://app.pinetree.test/api/webhooks/bridge",
      }),
      config: TEST_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toContain("pinetree.bridge.webhook")
  })

  it("fetches webhook details for verification configuration", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ id: "wh_fake_1234", public_key: "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----" })
    )

    const result = await fetchWebhookDetails({
      webhookId: "wh_fake_1234",
      config: TEST_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result.data.public_key).toContain("BEGIN PUBLIC KEY")
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BRIDGE_SANDBOX_BASE_URL}/webhooks/wh_fake_1234`)
    // A read must not carry an idempotency header.
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined()
  })
})

describe("Bridge redaction", () => {
  it("redacts credentials and signature headers but keeps correlation headers", () => {
    const redacted = redactBridgeHeaders({
      "Api-Key": FAKE_API_KEY,
      "X-Webhook-Signature": "t=1,v0=AAAA",
      "Idempotency-Key": "pinetree.bridge.onboarding.v1.abc",
      "x-request-id": "req_fake_1",
    })

    expect(redacted["Api-Key"]).toBe("[redacted]")
    expect(redacted["X-Webhook-Signature"]).toBe("[redacted]")
    expect(redacted["Idempotency-Key"]).toBe("pinetree.bridge.onboarding.v1.abc")
    expect(redacted["x-request-id"]).toBe("req_fake_1")
  })

  it("redacts onboarding identity, documents, and hosted capability URLs", () => {
    const redacted = redactBridgePayload({
      id: "cust_33333333-3333-4333-8333-333333333333",
      status: "under_review",
      full_name: "Fake Test Business LLC",
      email: "owner@fake-merchant.test",
      kyc_link: "https://bridge.test/kyc?session=fake-capability-token",
      tos_link: "https://bridge.test/tos?session=fake-capability-token",
      identifying_information: { ssn: "000-00-0000", document: "base64-fake" },
      address: { street_line_1: "1 Fake St" },
      endorsements: [{ name: "base", status: "approved" }],
    }) as Record<string, unknown>

    // Identifiers and statuses survive because diagnostics need them.
    expect(redacted.id).toBe("cust_33333333-3333-4333-8333-333333333333")
    expect(redacted.status).toBe("under_review")
    expect(redacted.endorsements).toEqual([{ name: "base", status: "approved" }])

    // Everything sensitive is gone.
    expect(redacted.full_name).toBe("[redacted]")
    expect(redacted.email).toBe("[redacted]")
    expect(redacted.kyc_link).toBe("[redacted]")
    expect(redacted.tos_link).toBe("[redacted]")
    expect(redacted.identifying_information).toBe("[redacted]")
    expect(redacted.address).toBe("[redacted]")

    const serialized = JSON.stringify(redacted)
    expect(serialized).not.toContain("Fake Test Business LLC")
    expect(serialized).not.toContain("owner@fake-merchant.test")
    expect(serialized).not.toContain("000-00-0000")
    expect(serialized).not.toContain("fake-capability-token")
  })

  it("masks emails and long digit runs in a non-JSON body summary", () => {
    const summary = bridgeSafeBodySummary("error for owner@fake-merchant.test id 123456789012")
    expect(summary).not.toContain("owner@fake-merchant.test")
    expect(summary).not.toContain("123456789012")
  })

  it("detects a leaked secret in arbitrary text", () => {
    expect(containsBridgeSecret(`key=${FAKE_API_KEY}`, [FAKE_API_KEY])).toBe(true)
    expect(containsBridgeSecret("nothing here", [FAKE_API_KEY])).toBe(false)
  })

  it("bounds recursion so a hostile payload cannot stall redaction", () => {
    type Nested = { next?: Nested }
    const deep: Nested = {}
    let cursor = deep
    for (let index = 0; index < 40; index += 1) {
      cursor.next = {}
      cursor = cursor.next
    }
    expect(() => redactBridgePayload(deep)).not.toThrow()
  })
})

describe("Bridge decimal amounts at the provider boundary", () => {
  it("accepts plain decimal strings only", () => {
    expect(assertBridgeDecimalAmount("10.00")).toBe("10.00")
    expect(() => assertBridgeDecimalAmount("1e3")).toThrow()
    expect(() => assertBridgeDecimalAmount("-1.00")).toThrow()
    expect(() => assertBridgeDecimalAmount("10,00")).toThrow()
  })

  it("converts minor units without floating point arithmetic", () => {
    expect(bridgeDecimalFromMinorUnits(1015)).toBe("10.15")
    expect(bridgeDecimalFromMinorUnits(5)).toBe("0.05")
    expect(bridgeDecimalFromMinorUnits(0)).toBe("0.00")
    // The float trap this rule exists to avoid: 0.1 + 0.2 !== 0.3.
    expect(bridgeDecimalFromMinorUnits(10 + 20)).toBe("0.30")
  })

  it("round-trips a decimal string back to exact minor units", () => {
    expect(bridgeMinorUnitsFromDecimal("10.15")).toBe(1015)
    expect(bridgeMinorUnitsFromDecimal("0.05")).toBe(5)
    expect(() => bridgeMinorUnitsFromDecimal("1.005")).toThrow(/more precision/)
  })
})
