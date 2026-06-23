import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
  getMerchantById: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  upsertPineTreeWalletProfile: vi.fn(),
  upsertMerchantLightningProfile: vi.fn(),
  createOrLinkSpeedConnectedAccountForMerchant: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

vi.mock("@/database/merchants", () => ({
  getMerchantById: mocks.getMerchantById,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
  upsertPineTreeWalletProfile: mocks.upsertPineTreeWalletProfile,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: vi.fn(),
  upsertMerchantLightningProfile: mocks.upsertMerchantLightningProfile,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: () => ({
    mode: "test",
    apiBaseUrl: "https://api.tryspeed.test",
  }),
}))

vi.mock("@/providers/lightning/speedConnectedAccounts", () => ({
  createOrLinkSpeedConnectedAccountForMerchant: mocks.createOrLinkSpeedConnectedAccountForMerchant,
}))

function request() {
  return new NextRequest("https://app.test/api/wallets/lightning/pinetree-managed", {
    method: "POST",
  })
}

function savedProfile(input: {
  status: "pending" | "ready" | "needs_attention"
  setupUrl?: string | null
  accountId?: string | null
  errorMessage?: string | null
}) {
  return {
    id: "mlp_1",
    merchant_id: merchantId,
    provider: "speed",
    status: input.status,
    speed_connected_account_id: input.accountId ?? null,
    speed_connected_account_status: input.status,
    speed_connect_setup_url: input.setupUrl ?? null,
    provider_response_summary: { source: input.setupUrl ? "invite_account_link" : "not_configured" },
    provider_error_message: input.errorMessage ?? null,
    receive_mode: "invoice",
    setup_source: "pinetree_managed",
    last_checked_at: "2026-06-23T12:00:00.000Z",
    created_at: "2026-06-23T12:00:00.000Z",
    updated_at: "2026-06-23T12:00:00.000Z",
  }
}

describe("POST /api/wallets/lightning/pinetree-managed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue(merchantId)
    mocks.getRouteErrorStatus.mockReturnValue(500)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: "merchant@example.test",
    })
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)
    mocks.upsertMerchantLightningProfile.mockImplementation(async (input) =>
      savedProfile({
        status: input.status,
        setupUrl: input.speedConnectSetupUrl,
        accountId: input.speedConnectedAccountId,
        errorMessage: input.providerErrorMessage,
      })
    )
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    delete process.env.SPEED_CONNECT_ENABLED
    delete process.env.SPEED_API_KEY
    delete process.env.SPEED_API_BASE_URL
    delete process.env.SPEED_CONNECT_RETURN_URL
  })

  it("re-runs Speed provisioning on every POST, including an existing pending retry", async () => {
    mocks.createOrLinkSpeedConnectedAccountForMerchant.mockResolvedValue({
      readiness: "pending",
      speed_connected_account_id: null,
      speed_connected_account_status: "speed_connect_disabled",
      setup_url: null,
      provider_response_summary: { source: "not_configured" },
      error_message: "Speed Connect is disabled until SPEED_CONNECT_ENABLED=true is configured.",
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    await POST(request())
    await POST(request())

    expect(mocks.createOrLinkSpeedConnectedAccountForMerchant).toHaveBeenCalledTimes(2)
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledTimes(2)
  })

  it("always saves last_checked_at through the upsert path and stores config errors", async () => {
    mocks.createOrLinkSpeedConnectedAccountForMerchant.mockResolvedValue({
      readiness: "needs_attention",
      speed_connected_account_id: null,
      speed_connected_account_status: "speed_api_key_missing",
      setup_url: null,
      provider_response_summary: { source: "not_configured" },
      error_message: "PineTree Speed platform is missing SPEED_API_KEY.",
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs_attention",
        providerErrorMessage: "PineTree Speed platform is missing SPEED_API_KEY.",
        providerResponseSummary: { source: "not_configured" },
      })
    )
    expect(body.profile.last_checked_at).toBe("2026-06-23T12:00:00.000Z")
  })

  it("stores Speed Connect invite setup URLs as pending", async () => {
    mocks.createOrLinkSpeedConnectedAccountForMerchant.mockResolvedValue({
      readiness: "pending",
      speed_connected_account_id: null,
      speed_connected_account_status: "speed_connect_invite_created",
      setup_url: "https://speed.test/connect/link_123",
      provider_response_summary: { source: "invite_account_link", setup_url_present: true },
      error_message: null,
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    await POST(request())

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        speedConnectSetupUrl: "https://speed.test/connect/link_123",
        providerResponseSummary: { source: "invite_account_link", setup_url_present: true },
      })
    )
  })

  it("stores active Speed connected accounts as ready without exposing secrets", async () => {
    mocks.createOrLinkSpeedConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_123",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {
        connected_account_id: "ca_123",
        account_id: "acct_123",
        source: "existing_connected_account",
      },
      error_message: null,
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = JSON.stringify(await response.json())

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        speedConnectedAccountId: "acct_123",
        speedConnectedAccountStatus: "active",
      })
    )
    expect(body).not.toContain("sk_test")
    expect(body).not.toContain("sk_live")
  })

  it("converts unexpected Speed helper failures into saved needs_attention profiles", async () => {
    mocks.createOrLinkSpeedConnectedAccountForMerchant.mockRejectedValue(
      new Error("Speed API returned 500 with sk_test_should_not_leak")
    )

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    await POST(request())

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs_attention",
        speedConnectedAccountStatus: "speed_connect_helper_failed",
        providerErrorMessage: expect.stringContaining("sk_test_[redacted]"),
        providerResponseSummary: expect.objectContaining({
          source: "error",
          status: "speed_connect_helper_failed",
        }),
      })
    )
  })
})
