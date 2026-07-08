import { beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  getMerchantById: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  upsertMerchantLightningProfile: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  upsertPineTreeWalletProfile: vi.fn(),
  saveMerchantSpeedConnection: vi.fn(),
  createSpeedCustomConnectedAccountForMerchant: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  isSpeedPlatformTreasurySweepEnabled: vi.fn(),
}))

vi.mock("@/database/merchants", () => ({
  getMerchantById: mocks.getMerchantById,
  // Mirrors the real (pure) implementation without importing the real module,
  // which would pull in the Supabase client and require live env vars.
  getMerchantBusinessOwnerProfile: (
    merchant: { owner_first_name?: string | null; owner_last_name?: string | null; business_country?: string | null } | null | undefined
  ) => {
    const ownerFirstName = String(merchant?.owner_first_name || "").trim()
    const ownerLastName = String(merchant?.owner_last_name || "").trim()
    const businessCountry = String(merchant?.business_country || "").trim().toUpperCase()
    if (!ownerFirstName || !ownerLastName || !businessCountry) return null
    return { ownerFirstName, ownerLastName, businessCountry }
  },
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
  upsertMerchantLightningProfile: mocks.upsertMerchantLightningProfile,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
  upsertPineTreeWalletProfile: mocks.upsertPineTreeWalletProfile,
}))

vi.mock("@/database/merchantProviders", () => ({
  saveMerchantSpeedConnection: mocks.saveMerchantSpeedConnection,
}))

vi.mock("@/providers/lightning/speedConnectedAccounts", () => ({
  createSpeedCustomConnectedAccountForMerchant: mocks.createSpeedCustomConnectedAccountForMerchant,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE: "speed_platform_treasury_sweep",
}))

function lightningProfile(input: {
  status: "not_configured" | "pending" | "ready" | "needs_attention"
  accountId?: string | null
  relationshipId?: string | null
  accountStatus?: string | null
}) {
  return {
    id: "mlp_1",
    merchant_id: merchantId,
    provider: "speed" as const,
    status: input.status,
    speed_connected_account_id: input.accountId ?? null,
    speed_connected_account_relationship_id: input.relationshipId ?? null,
    speed_account_id: input.accountId ?? null,
    speed_connected_account_status: input.accountStatus ?? null,
    speed_connect_setup_url: null,
    provider_response_summary: null,
    provider_error_message: null,
    receive_mode: "invoice" as const,
    setup_source: "pinetree_managed" as const,
    last_checked_at: "2026-07-08T00:00:00.000Z",
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
  }
}

describe("ensureManagedLightningForMerchant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)
    mocks.upsertMerchantLightningProfile.mockImplementation(async (input) =>
      lightningProfile({
        status: input.status,
        accountId: input.speedConnectedAccountId ?? input.speedAccountId,
        relationshipId: input.speedConnectedAccountRelationshipId,
        accountStatus: input.speedConnectedAccountStatus,
      })
    )
  })

  it("no-ops when merchant_lightning_profiles already has an active Speed account", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(
      lightningProfile({ status: "ready", accountId: "acct_123", relationshipId: "ca_123", accountStatus: "active" })
    )

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("already_active")
    expect(result.status).toBe("ready")
    expect(result.speedConnectedAccountId).toBe("acct_123")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.getMerchantById).not.toHaveBeenCalled()
  })

  it("marks needs_attention and does not call Speed when the business-owner profile is missing", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: "merchant@example.test",
      owner_first_name: null,
      owner_last_name: null,
      business_country: null,
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("needs_business_owner_profile")
    expect(result.status).toBe("needs_attention")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "needs_attention",
        speedConnectedAccountStatus: "business_owner_profile_required",
      })
    )
  })

  it("provisions Speed Custom Connect using the saved business-owner profile when the Lightning profile is missing", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "us",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_456",
      speed_connected_account_relationship_id: "ca_456",
      speed_account_id: "acct_456",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: { source: "existing_connected_account" },
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: merchantId,
        country: "US",
        first_name: "Ada",
        last_name: "Lovelace",
        email: "merchant@example.test",
      })
    )
    // A password is required by Speed's API but is generated and never persisted/returned.
    const call = mocks.createSpeedCustomConnectedAccountForMerchant.mock.calls[0][0]
    expect(typeof call.password).toBe("string")
    expect(call.password.length).toBeGreaterThan(10)

    expect(result.action).toBe("provisioned")
    expect(result.status).toBe("ready")
    expect(result.speedConnectedAccountId).toBe("acct_456")
    expect(result.speedConnectedAccountRelationshipId).toBe("ca_456")

    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "ready",
        speedConnectedAccountId: "acct_456",
        speedConnectedAccountRelationshipId: "ca_456",
        speedAccountId: "acct_456",
        speedConnectedAccountStatus: "active",
      })
    )
    expect(mocks.saveMerchantSpeedConnection).toHaveBeenCalledWith(
      merchantId,
      expect.objectContaining({ accountId: "acct_456", enabled: true })
    )
  })

  it("becomes ready only when Speed returns an active connected account, not merely a created one", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "pending",
      speed_connected_account_id: "acct_789",
      speed_connected_account_relationship_id: "ca_789",
      speed_account_id: "acct_789",
      speed_connected_account_status: "pending_verification",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("pending")
    expect(result.action).toBe("provisioning_incomplete")
  })

  it("does not call Speed Custom Connect in treasury-sweep mode", async () => {
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(true)
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({ configured: true, missing: [], apiBaseUrl: "https://api.tryspeed.test" })
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      merchant_id: merchantId,
      btc_address: "bc1ptestmerchant",
      btc_payout_enabled: true,
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("treasury_sweep_mode")
    expect(result.status).toBe("ready")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.getMerchantById).not.toHaveBeenCalled()
  })

  it("surfaces needs_attention from Speed without throwing", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "needs_attention",
      speed_connected_account_id: null,
      speed_connected_account_relationship_id: null,
      speed_account_id: null,
      speed_connected_account_status: "speed_custom_connect_failed",
      setup_url: null,
      provider_response_summary: {},
      error_message: "Speed custom connected account creation failed.",
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("needs_attention")
    expect(result.action).toBe("provisioning_incomplete")
    expect(mocks.saveMerchantSpeedConnection).not.toHaveBeenCalled()
  })
})

describe("no frontend surface calls Speed directly", () => {
  it("wallet-setup and providers pages only call PineTree's own API routes for Lightning", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8")

    const walletPage = read("app/dashboard/wallet-setup/page.tsx")
    const providersPage = read("app/dashboard/providers/page.tsx")

    for (const src of [walletPage, providersPage]) {
      expect(src).not.toContain("tryspeed.com")
      expect(src).not.toContain("api.tryspeed")
      expect(src).not.toMatch(/SPEED_API_KEY|sk_(test|live)_/)
    }

    // The only Lightning provisioning call from the client goes through PineTree's
    // own route, which internally delegates to ensureManagedLightningForMerchant.
    expect(walletPage).toContain('"/api/wallets/lightning/pinetree-managed"')
    expect(walletPage).toContain('"/api/merchant/business-owner-profile"')
  })
})
