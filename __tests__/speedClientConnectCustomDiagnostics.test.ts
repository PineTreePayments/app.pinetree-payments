import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Unit tests for the /connect/custom request path in speedClient.ts, aligned
 * to the official Speed Custom Connect API Documentation:
 * - The outgoing body matches the documented six-field contract exactly
 *   (country, account_type, first_name, last_name, email, password) - no
 *   phone, account_name, business_type, or other undocumented field.
 * - country is normalized to Speed's documented literal "United States",
 *   not the ISO code "US" (production proved "US" is rejected).
 * - account_type is always the literal "merchant".
 * - SpeedApiError carries Speed's real provider_code and sanitized field
 *   errors instead of collapsing every failure into a generic message.
 * - createSpeedCustomConnectedAccount emits the safe request diagnostic
 *   (never a raw password/email) around the call.
 */

const originalEnv = process.env

describe("normalizeSpeedCountry", () => {
  it("maps known US spellings to Speed's documented literal 'United States'", async () => {
    const { normalizeSpeedCountry } = await import("@/providers/lightning/speedClient")
    expect(normalizeSpeedCountry("US")).toBe("United States")
    expect(normalizeSpeedCountry("USA")).toBe("United States")
    expect(normalizeSpeedCountry("United States")).toBe("United States")
    expect(normalizeSpeedCountry("United States of America")).toBe("United States")
    expect(normalizeSpeedCountry("united states")).toBe("United States")
  })

  it("trims whitespace and collapses internal spacing before matching", async () => {
    const { normalizeSpeedCountry } = await import("@/providers/lightning/speedClient")
    expect(normalizeSpeedCountry("  US  ")).toBe("United States")
    expect(normalizeSpeedCountry(" United   States ")).toBe("United States")
  })

  it("rejects unsupported or ambiguous values instead of guessing - non-US countries are not supported for the initial launch", async () => {
    const { normalizeSpeedCountry } = await import("@/providers/lightning/speedClient")
    expect(normalizeSpeedCountry("CA")).toBeNull()
    expect(normalizeSpeedCountry("Canada")).toBeNull()
    expect(normalizeSpeedCountry("Mexico")).toBeNull()
    expect(normalizeSpeedCountry("")).toBeNull()
    expect(normalizeSpeedCountry(null)).toBeNull()
    expect(normalizeSpeedCountry(undefined)).toBeNull()
  })
})

describe("sanitizeSpeedErrorStructureForDiagnostics", () => {
  it("preserves every key from Speed's error body, not just field/message, so undiscovered metadata is still visible", async () => {
    const { sanitizeSpeedErrorStructureForDiagnostics } = await import("@/providers/lightning/speedClient")
    const body = JSON.stringify({
      error_code: "invalid_request_error",
      errors: [
        {
          field: "country",
          message: "Invalid Country. Your request can't be completed",
          allowed_values: ["United States"],
          parameter: "country",
          expected: "United States",
          country_id: 840,
          details: { reason: "unsupported_region" },
          documentation_url: "https://docs.tryspeed.com/errors/invalid-country",
        },
      ],
    })

    const sanitized = sanitizeSpeedErrorStructureForDiagnostics(body) as Record<string, unknown>
    const firstError = (sanitized.errors as Record<string, unknown>[])[0]
    expect(firstError.allowed_values).toEqual(["United States"])
    expect(firstError.parameter).toBe("country")
    expect(firstError.expected).toBe("United States")
    expect(firstError.country_id).toBe(840)
    expect(firstError.details).toEqual({ reason: "unsupported_region" })
    expect(firstError.documentation_url).toBe("https://docs.tryspeed.com/errors/invalid-country")
  })

  it("redacts sensitive substrings in string leaves at any depth", async () => {
    const { sanitizeSpeedErrorStructureForDiagnostics } = await import("@/providers/lightning/speedClient")
    const body = JSON.stringify({
      error_message: "Authorization failed for key sk_live_should_not_leak",
      nested: { detail: "contact merchant@example.test for help" },
    })

    const serialized = JSON.stringify(sanitizeSpeedErrorStructureForDiagnostics(body))
    expect(serialized).not.toContain("sk_live_should_not_leak")
    expect(serialized).not.toContain("merchant@example.test")
    expect(serialized).toContain("sk_live_[redacted]")
    expect(serialized).toContain("[redacted-email]")
  })

  it("returns null for an unparseable body instead of throwing", async () => {
    const { sanitizeSpeedErrorStructureForDiagnostics } = await import("@/providers/lightning/speedClient")
    expect(sanitizeSpeedErrorStructureForDiagnostics("not json")).toBeNull()
    expect(sanitizeSpeedErrorStructureForDiagnostics("")).toBeNull()
  })
})

describe("parseSpeedErrorBody email validation classification", () => {
  it("extracts safe field message details and classifies duplicate email errors", async () => {
    const { parseSpeedErrorBody } = await import("@/providers/lightning/speedClient")
    const parsed = parseSpeedErrorBody(JSON.stringify({
      error_code: "invalid_request_error",
      errors: [{ field: "email", code: "email_exists", rule: "unique", message: "Email is already registered" }],
    }))

    expect(parsed.providerCode).toBe("invalid_request_error")
    expect(parsed.fieldErrors[0]).toMatchObject({
      field: "email",
      message: "Email is already registered",
      validationCode: "email_exists",
      validationRule: "unique",
      duplicateEmail: true,
      malformedFormat: false,
      unsupportedDomain: false,
      emailLength: false,
      emailDeliverability: false,
    })
  })

  it("classifies unsupported-domain, malformed, length, and deliverability email validations without leaking emails", async () => {
    const { parseSpeedErrorBody } = await import("@/providers/lightning/speedClient")
    const parsed = parseSpeedErrorBody(JSON.stringify({
      errors: [
        { field: "email", message: "We don't accept sign-ups from <speed.pinetree-payments.com>. Please use a different email address!" },
        { field: "email", message: "Invalid email format for merchant@example.test" },
        { field: "email", message: "Email length exceeds maximum characters" },
        { field: "email", message: "Email mailbox is not deliverable; MX lookup failed" },
      ],
    }))

    expect(parsed.fieldErrors[0]).toMatchObject({ unsupportedDomain: true })
    expect(parsed.fieldErrors[1]).toMatchObject({ malformedFormat: true, message: "Invalid email format for [redacted-email]" })
    expect(parsed.fieldErrors[2]).toMatchObject({ emailLength: true })
    expect(parsed.fieldErrors[3]).toMatchObject({ emailDeliverability: true })
    expect(JSON.stringify(parsed)).not.toContain("merchant@example.test")
  })
})

describe("speedClient /connect/custom", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    process.env.SPEED_API_KEY = "sk_test_present"
    process.env.SPEED_WEBHOOK_SECRET = "wsec_present"
    process.env.SPEED_API_BASE_URL = "https://api.speed.test"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  it("sends exactly the six documented fields, with country as the literal 'United States' and account_type as 'merchant'", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "ca_1",
          object: "connected_account",
          platform_account_id: "acct_platform",
          account_id: "acct_1",
          type: "custom",
          status: "Active",
        }),
        { status: 200 }
      )
    )

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    const account = await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "USER",
      lastName: "CVS",
      email: "user@example.com",
      password: "temporary-secret",
    })

    expect(account.account_id).toBe("acct_1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.speed.test/connect/custom")
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      country: "United States",
      account_type: "merchant",
      first_name: "USER",
      last_name: "CVS",
      email: "user@example.com",
      password: "temporary-secret",
    })
    expect(Object.keys(body).sort()).toEqual(
      ["account_type", "country", "email", "first_name", "last_name", "password"].sort()
    )
  })

  it("logs safe pre-fetch email metadata and required-field presence without logging the email or password", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: "ca_1", account_id: "acct_1", status: "Active" }),
        { status: 200 }
      )
    )
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "speed-18215ad9c5874be5baf46bef03cb81fc@pinetree-payments.com",
      password: "temporary-secret",
    })

    const prefetchCall = info.mock.calls.find((call) => call[0] === "[speed] speed_connect_custom_prefetch_diagnostic")
    expect(prefetchCall?.[1]).toMatchObject({
      emailPresent: true,
      emailTotalLength: 60,
      emailLocalPartLength: 38,
      emailDomainLength: 21,
      emailHasAtSign: true,
      emailHasWhitespace: false,
      emailUsesManagedRootDomain: true,
      emailLocalPartAlphanumericHyphenOnly: true,
      passwordConfigured: true,
      requiredFieldsPresent: true,
    })
    expect(JSON.stringify(info.mock.calls)).not.toContain("speed-18215ad9c5874be5baf46bef03cb81fc")
    expect(JSON.stringify(info.mock.calls)).not.toContain("temporary-secret")

    info.mockRestore()
  })

  it("never includes phone, account_name, business_type, or any other undocumented field in the request body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "ca_2", account_id: "acct_2", status: "Active" }), { status: 200 })
    )

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body).not.toHaveProperty("phone")
    expect(body).not.toHaveProperty("account_name")
    expect(body).not.toHaveProperty("business_type")
    expect(body).not.toHaveProperty("business_name")
    expect(body).not.toHaveProperty("address")
  })

  it("rejects an unsupported country locally without ever calling Speed", async () => {
    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")

    await expect(
      createSpeedCustomConnectedAccount({
        country: "Canada",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "merchant@example.test",
        password: "temporary-secret",
      })
    ).rejects.toThrow("country is not supported")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("captures Speed's provider_code and per-field errors array shape from a 400 response", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error_code: "invalid_request",
          errors: [{ field: "email", message: "email already registered" }, "password too weak"],
        }),
        { status: 400 }
      )
    )

    const { createSpeedCustomConnectedAccount, SpeedApiError } = await import("@/providers/lightning/speedClient")
    await expect(
      createSpeedCustomConnectedAccount({
        country: "US",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "merchant@example.test",
        password: "temporary-secret",
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SpeedApiError)
      const speedError = error as InstanceType<typeof SpeedApiError>
      expect(speedError.status).toBe(400)
      expect(speedError.providerCode).toBe("invalid_request")
      expect(speedError.fieldErrors).toMatchObject([
        {
          field: "email",
          message: "email already registered",
          duplicateEmail: true,
          malformedFormat: false,
          unsupportedDomain: false,
          emailLength: false,
          emailDeliverability: false,
        },
        { field: null, message: "password too weak" },
      ])
      return true
    })
  })

  it("captures a single error_message shape when Speed doesn't return a field errors array", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_code: "validation_error", error_message: "Country is required" }), {
        status: 400,
      })
    )

    const { createSpeedCustomConnectedAccount, SpeedApiError } = await import("@/providers/lightning/speedClient")
    await expect(
      createSpeedCustomConnectedAccount({
        country: "US",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "merchant@example.test",
        password: "temporary-secret",
      })
    ).rejects.toSatisfy((error: unknown) => {
      const speedError = error as InstanceType<typeof SpeedApiError>
      expect(speedError.providerCode).toBe("validation_error")
      expect(speedError.fieldErrors).toMatchObject([{ field: null, message: "Country is required" }])
      expect(speedError.providerMessage).toBe("Country is required")
      return true
    })
  })

  it("captures nested provider error shapes safely", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "validation_failed",
            data: {
              field_errors: [
                { field: "last_name", error_message: "Last name is required" },
              ],
            },
          },
        }),
        { status: 400 }
      )
    )

    const { createSpeedCustomConnectedAccount, SpeedApiError } = await import("@/providers/lightning/speedClient")
    await expect(
      createSpeedCustomConnectedAccount({
        country: "US",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "merchant@example.test",
        password: "temporary-secret",
      })
    ).rejects.toSatisfy((error: unknown) => {
      const speedError = error as InstanceType<typeof SpeedApiError>
      expect(speedError.providerCode).toBe("validation_failed")
      expect(speedError.fieldErrors).toMatchObject([
        { field: "last_name", message: "Last name is required" },
      ])
      expect(speedError.message).toBe("Speed API returned 400")
      return true
    })
  })

  it("blocks an explicitly invalid email before calling Speed", async () => {
    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")

    await expect(
      createSpeedCustomConnectedAccount({
        country: "US",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "not-an-email",
        password: "temporary-secret",
        emailValid: false,
      })
    ).rejects.toThrow("email is invalid")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never leaks the account password, and redacts an echoed API key, from a rejected response body", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error_code: "invalid_request",
          error_message: "Authorization failed for key sk_live_should_not_leak_ever",
        }),
        { status: 400 }
      )
    )

    const { createSpeedCustomConnectedAccount, SpeedApiError } = await import("@/providers/lightning/speedClient")
    await expect(
      createSpeedCustomConnectedAccount({
        country: "US",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "merchant@example.test",
        password: "super-secret-password-value",
      })
    ).rejects.toSatisfy((error: unknown) => {
      const speedError = error as InstanceType<typeof SpeedApiError>
      const serialized = JSON.stringify(speedError.fieldErrors)
      expect(serialized).not.toContain("super-secret-password-value")
      expect(serialized).not.toContain("sk_live_should_not_leak_ever")
      expect(serialized).toContain("sk_live_[redacted]")
      return true
    })
  })

  it("logs the request diagnostic with presence/policy booleans and never the raw password, email, first name, or last name", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "ca_3", account_id: "acct_3", status: "Active" }), { status: 200 })
    )
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "PineTree Test Merchant LLC",
      email: "merchant@example.test",
      password: "temporary-secret-value",
      emailValid: true,
      passwordPolicyValid: true,
    })

    const diagnosticCalls = info.mock.calls.filter((call) => call[0] === "[speed] speed_connect_custom_request_diagnostic")
    expect(diagnosticCalls.length).toBeGreaterThanOrEqual(1)
    expect(diagnosticCalls[0][1]).toMatchObject({
      endpoint: "/connect/custom",
      requestStarted: true,
      emailPresent: true,
      emailValid: true,
      passwordPresent: true,
      passwordPolicyValid: true,
      firstNamePresent: true,
      lastNamePresent: true,
      countryPresent: true,
    })
    const serialized = JSON.stringify(diagnosticCalls)
    expect(serialized).not.toContain("temporary-secret-value")
    expect(serialized).not.toContain("merchant@example.test")
    expect(serialized).not.toContain("Ada")
    expect(serialized).not.toContain("PineTree Test Merchant LLC")

    info.mockRestore()
  })

  it("includes the API hostname and elapsed time (never the full URL) in the generic failure log", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_code: "invalid_request", error_message: "bad request" }), { status: 400 })
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    }).catch(() => undefined)

    const failedCall = errorSpy.mock.calls.find((call) => call[0] === "[speed] API request failed")
    expect(failedCall?.[1]).toMatchObject({ apiHost: "api.speed.test" })
    expect(typeof failedCall?.[1].elapsedMs).toBe("number")

    errorSpy.mockRestore()
  })

  it("reports the failed providerStatus/providerCode in the post-request diagnostic", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_code: "invalid_request", error_message: "bad request" }), { status: 400 })
    )
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    }).catch(() => undefined)

    const diagnosticCalls = info.mock.calls.filter((call) => call[0] === "[speed] speed_connect_custom_request_diagnostic")
    const finalDiagnostic = diagnosticCalls[diagnosticCalls.length - 1][1]
    expect(finalDiagnostic).toMatchObject({
      providerStatus: 400,
      providerCode: "invalid_request",
      providerFieldErrorCount: 1,
    })

    info.mockRestore()
  })

  it("logs the full sanitized error structure for a rejected /connect/custom request, including metadata parseSpeedErrorBody would otherwise drop", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error_code: "invalid_request_error",
          errors: [
            {
              field: "country",
              message: "Invalid Country. Your request can't be completed",
              allowed_values: ["United States"],
              country_id: 840,
            },
          ],
        }),
        { status: 400 }
      )
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    }).catch(() => undefined)

    const detailCall = warnSpy.mock.calls.find((call) => call[0] === "[speed] speed_custom_connect_error_detail")
    expect(detailCall).toBeTruthy()
    expect(detailCall?.[1]).toMatchObject({ status: 400 })
    const sanitizedBody = detailCall?.[1].sanitizedErrorBody as { errors: Array<Record<string, unknown>> }
    expect(sanitizedBody.errors[0].allowed_values).toEqual(["United States"])
    expect(sanitizedBody.errors[0].country_id).toBe(840)

    warnSpy.mockRestore()
  })

  it("never logs this diagnostic for non-/connect/custom endpoints", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_code: "invalid_request", error_message: "bad request" }), { status: 400 })
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const { createSpeedConnectAccountLink } = await import("@/providers/lightning/speedClient")
    await createSpeedConnectAccountLink({}).catch(() => undefined)

    expect(warnSpy.mock.calls.some((call) => call[0] === "[speed] speed_custom_connect_error_detail")).toBe(false)

    warnSpy.mockRestore()
  })
})
