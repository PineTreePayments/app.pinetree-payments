import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const speedClientMocks = vi.hoisted(() => ({
  createSpeedConnectAccountLink: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  listSpeedConnectedAccounts: vi.fn(),
  retrieveSpeedConnectedAccount: vi.fn(),
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  createSpeedConnectAccountLink: speedClientMocks.createSpeedConnectAccountLink,
  getPineTreeSpeedConfigStatus: speedClientMocks.getPineTreeSpeedConfigStatus,
  listSpeedConnectedAccounts: speedClientMocks.listSpeedConnectedAccounts,
  retrieveSpeedConnectedAccount: speedClientMocks.retrieveSpeedConnectedAccount,
}))

import { createOrLinkSpeedConnectedAccountForMerchant } from "@/providers/lightning/speedConnectedAccounts"

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
})
