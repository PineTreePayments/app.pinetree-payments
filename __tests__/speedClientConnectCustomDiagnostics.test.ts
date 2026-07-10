import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Unit tests for the /connect/custom request path in speedClient.ts:
 * - SpeedApiError carries Speed's real provider_code and sanitized field
 *   errors instead of collapsing every failure into a generic message.
 * - createSpeedCustomConnectedAccount emits the safe request diagnostic
 *   (never a raw password/email) around the call.
 * - account_name is sent when a business name is available.
 */

const originalEnv = process.env

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

  it("succeeds with a valid payload and includes account_name when a business name is present", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "ca_1", account_id: "acct_1", status: "Active" }), { status: 200 })
    )

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    const account = await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
      businessName: "PineTree Test Merchant LLC",
    })

    expect(account.account_id).toBe("acct_1")
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body.account_name).toBe("PineTree Test Merchant LLC")
    expect(body.email).toBe("merchant@example.test")
  })

  it("omits account_name when no business name is available", async () => {
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
    expect(body).not.toHaveProperty("account_name")
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
      expect(speedError.fieldErrors).toEqual(["email: email already registered", "password too weak"])
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
      expect(speedError.fieldErrors).toEqual(["Country is required"])
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
                { field: "account_name", error_message: "Business name is required" },
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
      expect(speedError.fieldErrors).toEqual(["account_name: Business name is required"])
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

  it("logs the request diagnostic with presence/policy booleans and never the raw password or email", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "ca_3", account_id: "acct_3", status: "Active" }), { status: 200 })
    )
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const { createSpeedCustomConnectedAccount } = await import("@/providers/lightning/speedClient")
    await createSpeedCustomConnectedAccount({
      country: "US",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret-value",
      businessName: "PineTree Test Merchant LLC",
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
      businessNamePresent: true,
      countryPresent: true,
    })
    const serialized = JSON.stringify(diagnosticCalls)
    expect(serialized).not.toContain("temporary-secret-value")
    expect(serialized).not.toContain("merchant@example.test")

    info.mockRestore()
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
    })
    expect(finalDiagnostic.providerFieldErrors).toEqual(["bad request"])

    info.mockRestore()
  })
})
