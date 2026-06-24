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
  getPineTreeSpeedConfigStatus: vi.fn(),
  isSpeedPlatformTreasurySweepEnabled: vi.fn(),
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
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE: "speed_platform_treasury_sweep",
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
  accountStatus?: string | null
  errorMessage?: string | null
}) {
  return {
    id: "mlp_1",
    merchant_id: merchantId,
    provider: "speed",
    status: input.status,
    speed_connected_account_id: input.accountId ?? null,
    speed_connected_account_status: input.accountStatus ?? input.status,
    speed_connect_setup_url: input.setupUrl ?? null,
    provider_response_summary: {},
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
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({
      configured: true,
      missing: [],
      mode: "test",
      apiBaseUrl: "https://api.tryspeed.test",
    })
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(true)
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "wallet_1",
      merchant_id: merchantId,
      btc_address: "bc1ptestmerchant",
      btc_address_type: "taproot",
      btc_payout_enabled: true,
      created_at: "2026-06-23T12:00:00.000Z",
      updated_at: "2026-06-23T12:00:00.000Z",
    })
    mocks.upsertMerchantLightningProfile.mockImplementation(async (input) =>
      savedProfile({
        status: input.status,
        setupUrl: input.speedConnectSetupUrl,
        accountId: input.speedConnectedAccountId,
        accountStatus: input.speedConnectedAccountStatus,
        errorMessage: input.providerErrorMessage,
      })
    )
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  it("canonical treasury-sweep mode does not create a merchant Speed Connect account", async () => {
    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.createOrLinkSpeedConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        speedConnectedAccountId: null,
        speedConnectedAccountStatus: "pinetree_wallet_btc_payout_ready",
        speedConnectSetupUrl: null,
        providerErrorMessage: null,
        providerResponseSummary: expect.objectContaining({
          source: "speed_platform_treasury_sweep",
          settlement_mode: "speed_platform_treasury_sweep",
          speed_configured: true,
          btc_address_present: true,
          btc_payout_enabled: true,
        }),
      })
    )
    expect(mocks.upsertPineTreeWalletProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        bitcoinLightningStatus: "ready",
        bitcoinLightningProvider: "speed",
        bitcoinLightningAccountId: null,
        bitcoinLightningReceiveMode: "invoice",
      })
    )
    expect(body.profile.status).toBe("ready")
    expect(JSON.stringify(body)).not.toContain("sk_test")
    expect(JSON.stringify(body)).not.toContain("sk_live")
  })

  it("canonical mode stays merchant-ready and records an internal issue when the BTC payout address is missing", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "wallet_1",
      merchant_id: merchantId,
      btc_address: null,
      btc_payout_enabled: false,
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.createOrLinkSpeedConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        speedConnectedAccountId: null,
        speedConnectedAccountStatus: "btc_address_missing_internal",
        speedConnectSetupUrl: null,
        providerErrorMessage: null,
        providerResponseSummary: expect.objectContaining({
          source: "speed_platform_treasury_sweep",
          btc_address_present: false,
          btc_payout_enabled: false,
          internal_readiness_issue: "btc_address_missing",
        }),
      })
    )
    expect(body.profile.status).toBe("ready")
  })

  it("canonical mode needs attention when PineTree Speed platform config is missing", async () => {
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({
      configured: false,
      missing: ["SPEED_API_KEY", "SPEED_WEBHOOK_SECRET"],
      mode: "test",
      apiBaseUrl: "https://api.tryspeed.test",
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs_attention",
        speedConnectedAccountStatus: "speed_platform_config_missing",
        providerErrorMessage: "PineTree Speed platform missing: SPEED_API_KEY, SPEED_WEBHOOK_SECRET",
        providerResponseSummary: expect.objectContaining({
          speed_configured: false,
          speed_missing: ["SPEED_API_KEY", "SPEED_WEBHOOK_SECRET"],
        }),
      })
    )
    expect(body.profile.status).toBe("needs_attention")
  })

  it("legacy Speed Connect behavior is isolated behind the disabled treasury-sweep flag", async () => {
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.createOrLinkSpeedConnectedAccountForMerchant.mockResolvedValue({
      readiness: "pending",
      speed_connected_account_id: null,
      speed_connected_account_status: "speed_connect_invite_created",
      setup_url: "https://speed.test/connect/link_123",
      provider_response_summary: { source: "invite_account_link", setup_url_present: true },
      error_message: null,
    })

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.createOrLinkSpeedConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        speedConnectSetupUrl: "https://speed.test/connect/link_123",
        providerResponseSummary: { source: "invite_account_link", setup_url_present: true },
      })
    )
  })
})
