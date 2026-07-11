import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const speedClientMocks = vi.hoisted(() => ({
  createSpeedCustomConnectedAccount: vi.fn(),
  createSpeedConnectAccountLink: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  getSpeedApiHost: vi.fn(() => "api.tryspeed.test"),
  listSpeedConnectedAccounts: vi.fn(),
  retrieveSpeedConnectedAccount: vi.fn(),
}))

vi.mock("@/providers/lightning/speedClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/lightning/speedClient")>()
  return {
    createSpeedCustomConnectedAccount: speedClientMocks.createSpeedCustomConnectedAccount,
    createSpeedConnectAccountLink: speedClientMocks.createSpeedConnectAccountLink,
    getPineTreeSpeedConfigStatus: speedClientMocks.getPineTreeSpeedConfigStatus,
    getSpeedApiHost: speedClientMocks.getSpeedApiHost,
    listSpeedConnectedAccounts: speedClientMocks.listSpeedConnectedAccounts,
    retrieveSpeedConnectedAccount: speedClientMocks.retrieveSpeedConnectedAccount,
    // Real class, not a mock - speedConnectedAccounts.ts does `instanceof
    // SpeedApiError` to extract providerCode/fieldErrors from a rejection.
    SpeedApiError: actual.SpeedApiError,
  }
})

import {
  createOrLinkSpeedConnectedAccountForMerchant,
  createSpeedCustomConnectedAccountForMerchant
} from "@/providers/lightning/speedConnectedAccounts"
import { SpeedApiError } from "@/providers/lightning/speedClient"

const originalEnv = process.env

function input() {
  return {
    merchant_id: "merchant_123",
    business_name: "PineTree Test Merchant",
    merchant_email: "merchant@example.test",
    pinetree_reference_id: "pinetree-merchant:merchant_123",
  }
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    mode: "test",
    apiBaseUrl: "https://api.tryspeed.test",
    dashboardUrl: null,
    missing: [],
    warnings: [],
    environmentKeyMismatch: false,
    ...overrides,
  }
}

describe("createOrLinkSpeedConnectedAccountForMerchant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.SPEED_CONNECT_ENABLED = "true"
    process.env.SPEED_API_KEY = "sk_test_present"
    process.env.SPEED_CONNECT_RETURN_URL = "https://app.test/api/wallets/lightning/speed/connect-return"
    speedClientMocks.getPineTreeSpeedConfigStatus.mockReturnValue(config())
    speedClientMocks.listSpeedConnectedAccounts.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("returns pending with a safe error message when Speed Connect is disabled", async () => {
    process.env.SPEED_CONNECT_ENABLED = "false"

    const result = await createOrLinkSpeedConnectedAccountForMerchant(input())

    expect(result.readiness).toBe("pending")
    expect(result.error_message).toContain("SPEED_CONNECT_ENABLED=true")
    expect(result.provider_response_summary.source).toBe("not_configured")
    expect(speedClientMocks.createSpeedConnectAccountLink).not.toHaveBeenCalled()
  })

  it("returns needs_attention when SPEED_API_KEY is missing", async () => {
    delete process.env.SPEED_API_KEY

    const result = await createOrLinkSpeedConnectedAccountForMerchant(input())

    expect(result.readiness).toBe("needs_attention")
    expect(result.speed_connected_account_status).toBe("speed_api_key_missing")
    expect(result.error_message).toBe("PineTree Speed platform is missing SPEED_API_KEY.")
    expect(speedClientMocks.createSpeedConnectAccountLink).not.toHaveBeenCalled()
  })

  it("returns pending with setup_url and provider_response_summary when Speed returns an invite link", async () => {
    speedClientMocks.createSpeedConnectAccountLink.mockResolvedValue({
      link: "https://speed.test/connect/link_123",
    })

    const result = await createOrLinkSpeedConnectedAccountForMerchant(input())

    expect(result.readiness).toBe("pending")
    expect(result.setup_url).toBe("https://speed.test/connect/link_123")
    expect(result.provider_response_summary).toMatchObject({
      source: "invite_account_link",
      setup_url_present: true,
    })
  })

  it("returns ready with a connected account id when Speed has an active account", async () => {
    speedClientMocks.listSpeedConnectedAccounts.mockResolvedValue({
      data: [
        {
          id: "ca_123",
          account_id: "acct_123",
          account_name: "Merchant",
          owner_email: "merchant@example.test",
          status: "active",
          type: "Standard",
        },
      ],
    })

    const result = await createOrLinkSpeedConnectedAccountForMerchant(input())

    expect(result.readiness).toBe("ready")
    expect(result.speed_connected_account_id).toBe("acct_123")
    expect(result.speed_connected_account_relationship_id).toBe("ca_123")
    expect(result.speed_account_id).toBe("acct_123")
    expect(result.speed_connected_account_status).toBe("active")
    expect(result.provider_response_summary.source).toBe("existing_connected_account")
    expect(speedClientMocks.createSpeedConnectAccountLink).not.toHaveBeenCalled()
  })

  it("returns needs_attention with a redacted provider_error_message when Speed request fails", async () => {
    speedClientMocks.createSpeedConnectAccountLink.mockRejectedValue(
      new Error("Speed failed with sk_live_should_not_leak")
    )

    const result = await createOrLinkSpeedConnectedAccountForMerchant(input())

    expect(result.readiness).toBe("needs_attention")
    expect(result.speed_connected_account_status).toBe("speed_connect_invite_failed")
    expect(result.error_message).toContain("sk_live_[redacted]")
    expect(result.error_message).not.toContain("sk_live_should_not_leak")
    expect(result.provider_response_summary.source).toBe("error")
  })

  it("creates a custom connected account and returns both Speed ids", async () => {
    speedClientMocks.createSpeedCustomConnectedAccount.mockResolvedValue({
      id: "ca_custom_123",
      platform_account_id: "acct_platform",
      account_id: "acct_custom_123",
      account_name: "Merchant",
      owner_email: "merchant@example.test",
      status: "Active",
      type: "merchant",
    })

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(result.readiness).toBe("ready")
    expect(result.speed_connected_account_relationship_id).toBe("ca_custom_123")
    expect(result.speed_account_id).toBe("acct_custom_123")
    expect(result.speed_connected_account_id).toBe("acct_custom_123")
    expect(result.provider_response_summary).toMatchObject({
      connected_account_id: "ca_custom_123",
      platform_account_id: "acct_platform",
      account_id: "acct_custom_123",
      status: "Active",
    })
  })

  it("forwards businessName, phone, accountType, and pre-computed policy booleans to the Speed client call", async () => {
    speedClientMocks.createSpeedCustomConnectedAccount.mockResolvedValue({
      id: "ca_custom_biz",
      account_id: "acct_custom_biz",
      status: "Active",
    })

    await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
      business_name: "PineTree Test Merchant LLC",
      phone: "+14155551234",
      account_type: "merchant",
      email_valid: true,
      password_policy_valid: true,
    })

    expect(speedClientMocks.createSpeedCustomConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: "PineTree Test Merchant LLC",
        phone: "+14155551234",
        accountType: "merchant",
        emailValid: true,
        passwordPolicyValid: true,
      })
    )
  })

  it("captures Speed's provider code and sanitized field errors from a rejected /connect/custom request instead of collapsing to a generic failure", async () => {
    speedClientMocks.createSpeedCustomConnectedAccount.mockRejectedValue(
      new SpeedApiError("Speed API returned 400: validation failed", 400, "invalid_request", [
        { field: "email", message: "already registered" },
        { field: "password", message: "too weak" },
      ])
    )

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(result.readiness).toBe("needs_attention")
    expect(result.provider_code).toBe("invalid_request")
    expect(result.field_errors).toEqual([
      { field: "email", message: "already registered" },
      { field: "password", message: "too weak" },
    ])
    expect(result.provider_http_status).toBe(400)
  })

  it("emits a speed_custom_connect_rejected diagnostic with sanitized presence booleans and never a raw secret", async () => {
    speedClientMocks.createSpeedCustomConnectedAccount.mockRejectedValue(
      new SpeedApiError("Speed API returned 400", 400, "invalid_request", [
        { field: "phone", message: "invalid format" },
      ])
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "super-secret-password",
      phone: "+1415000bad",
    })

    const rejectedCall = warnSpy.mock.calls.find((call) => call[0] === "[speed-custom-connect] speed_custom_connect_rejected")
    expect(rejectedCall?.[1]).toMatchObject({
      merchant_id: "merchant_123",
      status: 400,
      provider_code: "invalid_request",
      field_errors: [{ field: "phone", message: "invalid format" }],
      request_presence: {
        email: true,
        password: true,
        business_name: false,
        first_name: true,
        last_name: true,
        phone: true,
      },
    })
    expect(typeof rejectedCall?.[1].elapsed_ms).toBe("number")
    expect(typeof rejectedCall?.[1].api_host).toBe("string")
    const serialized = JSON.stringify(warnSpy.mock.calls)
    expect(serialized).not.toContain("super-secret-password")
    expect(serialized).not.toContain("+1415000bad")
    expect(serialized).not.toContain("merchant@example.test")

    warnSpy.mockRestore()
  })

  it("owner_email_present in provider_response_summary reflects Speed's response, not the outgoing request - false on an error response even when email was sent", async () => {
    // Reproduces the exact saved provider_response_summary from a production
    // country rejection: owner_email_present: false alongside a real
    // field_errors entry. This is expected - the error path always summarizes
    // a null account object (there is no response account to read an email
    // off of), regardless of whether the request itself included an email.
    speedClientMocks.createSpeedCustomConnectedAccount.mockRejectedValue(
      new SpeedApiError("Speed API returned 400", 400, "invalid_request_error", [
        { field: "country", message: "Invalid Country. Your request can't be completed" },
      ])
    )

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(speedClientMocks.createSpeedCustomConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: "merchant@example.test" })
    )
    expect(result.provider_response_summary.owner_email_present).toBe(false)
  })

  it("owner_email_present reflects Speed's returned account object on success", async () => {
    speedClientMocks.createSpeedCustomConnectedAccount.mockResolvedValue({
      id: "ca_email",
      account_id: "acct_email",
      status: "Active",
      owner_email: "merchant@example.test",
    })

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(result.provider_response_summary.owner_email_present).toBe(true)
  })

  it("reports a null provider code and empty field errors for a non-provider (network/unknown) failure", async () => {
    speedClientMocks.createSpeedCustomConnectedAccount.mockRejectedValue(new Error("network unreachable"))

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(result.readiness).toBe("needs_attention")
    expect(result.provider_code).toBeNull()
    expect(result.field_errors).toEqual([])
  })

  it("reuses an existing custom connected account by email instead of creating a duplicate", async () => {
    speedClientMocks.listSpeedConnectedAccounts.mockResolvedValue({
      data: [{
        id: "ca_existing",
        account_id: "acct_existing",
        owner_email: "merchant@example.test",
        status: "active",
      }],
    })

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(result.readiness).toBe("ready")
    expect(result.speed_account_id).toBe("acct_existing")
    expect(speedClientMocks.createSpeedCustomConnectedAccount).not.toHaveBeenCalled()
  })

  it("does not create a duplicate when existing-account lookup fails", async () => {
    speedClientMocks.listSpeedConnectedAccounts.mockRejectedValue(new Error("lookup unavailable"))

    const result = await createSpeedCustomConnectedAccountForMerchant({
      merchant_id: "merchant_123",
      country: "US",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "merchant@example.test",
      password: "temporary-secret",
    })

    expect(result.readiness).toBe("needs_attention")
    expect(result.speed_connected_account_status).toBe("existing_account_lookup_failed")
    expect(speedClientMocks.createSpeedCustomConnectedAccount).not.toHaveBeenCalled()
  })
})
