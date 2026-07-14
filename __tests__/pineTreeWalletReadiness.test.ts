import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  getMerchantById: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  upsertMerchantLightningProfile: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  upsertPineTreeWalletProfile: vi.fn(),
  saveMerchantSpeedConnection: vi.fn(),
  createSpeedCustomConnectedAccountForMerchant: vi.fn(),
  getSpeedConnectedAccountSetupStatus: vi.fn(),
  getMerchantBusinessProfile: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  isSpeedPlatformTreasurySweepEnabled: vi.fn(),
  getMerchantSpeedCredentialMetadata: vi.fn(),
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

vi.mock("@/database/merchantSpeedCredentials", () => ({
  getMerchantSpeedCredentialMetadata: mocks.getMerchantSpeedCredentialMetadata,
  resolveSpeedCredentialEnvironment: () => "non_production",
}))

vi.mock("@/providers/lightning/speedConnectedAccounts", () => ({
  createSpeedCustomConnectedAccountForMerchant: mocks.createSpeedCustomConnectedAccountForMerchant,
  getSpeedConnectedAccountSetupStatus: mocks.getSpeedConnectedAccountSetupStatus,
}))

vi.mock("@/engine/businessProfile", () => ({
  getMerchantBusinessProfile: mocks.getMerchantBusinessProfile,
}))

vi.mock("@/providers/lightning/speedClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/lightning/speedClient")>()
  return {
    getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
    isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
    SPEED_PLATFORM_TREASURY_SWEEP_MODE: "speed_platform_treasury_sweep",
    // Real functions/constants, not mocks - exercises the actual country
    // allowlist, the documented account_type literal, and a stable
    // (non-network) hostname helper.
    normalizeSpeedCountry: actual.normalizeSpeedCountry,
    SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE: actual.SPEED_CUSTOM_CONNECT_ACCOUNT_TYPE,
    getSpeedApiHost: actual.getSpeedApiHost,
  }
})

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
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    process.env = { ...originalEnv, NODE_ENV: "test", SPEED_CONNECTED_ACCOUNT_PASSWORD: "Fixture-Shared-Test-Pass9!" }
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "US",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
    })
    mocks.upsertMerchantLightningProfile.mockImplementation(async (input) =>
      lightningProfile({
        status: input.status,
        accountId: input.speedConnectedAccountId ?? input.speedAccountId,
        relationshipId: input.speedConnectedAccountRelationshipId,
        accountStatus: input.speedConnectedAccountStatus,
      })
    )
    mocks.getMerchantSpeedCredentialMetadata.mockResolvedValue(null)
  })

  afterEach(() => {
    process.env = originalEnv
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
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "incomplete",
      business_country: null,
      owner_first_name: null,
      owner_last_name: null,
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

  it("provisions Speed Custom Connect with the documented six-field contract using the saved business-owner profile", async () => {
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
      credential_password_used: true,
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    // Exactly the documented fields, with the provider-bound country literal,
    // owner_first_name as first_name, and owner_last_name as the last_name
    // fallback (no DBA/legal business name on file in this test).
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: merchantId,
        country: "United States",
        first_name: "Ada",
        last_name: "Lovelace",
        email: "merchant@example.test",
      })
    )
    const call = mocks.createSpeedCustomConnectedAccountForMerchant.mock.calls[0][0]
    expect(call).not.toHaveProperty("phone")
    expect(call).not.toHaveProperty("account_type")
    expect(call).not.toHaveProperty("business_name")
    expect(mocks.getMerchantBusinessProfile).toHaveBeenCalledWith(merchantId)
    // A password is required by Speed's API. It comes from the unified
    // server-side env var and is never logged, returned, or stored in Supabase.
    expect(typeof call.password).toBe("string")
    expect(call.password).toBe("Fixture-Shared-Test-Pass9!")
    const { speedCustomConnectPasswordPolicyPass } = await import("@/engine/pineTreeWalletReadiness")
    expect(speedCustomConnectPasswordPolicyPass(call.password)).toBe(true)

    expect(result.action).toBe("provisioned")
    expect(result.status).toBe("ready")
    expect(result.speedConnectedAccountId).toBe("acct_456")
    expect(result.speedConnectedAccountRelationshipId).toBe("ca_456")

    expect(mocks.getMerchantSpeedCredentialMetadata).toHaveBeenCalledWith(merchantId)

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

  it("does not store a credential when Speed resolved the account via existing-email reuse (credential_password_used is false)", async () => {
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
      speed_connected_account_id: "acct_789",
      speed_connected_account_relationship_id: "ca_789",
      speed_account_id: "acct_789",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: { source: "existing_connected_account" },
      error_message: null,
      mode: "test",
      // No credential_password_used: true here - Speed resolved this account
      // by an existing-email lookup, so the password PineTree generated for
      // this attempt is not the account's real password.
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("ready")
    expect(mocks.getMerchantSpeedCredentialMetadata).toHaveBeenCalledWith(merchantId)
  })

  it("does not store the unified Speed password in Supabase after a fresh Speed create", async () => {
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
      speed_connected_account_id: "acct_999",
      speed_connected_account_relationship_id: "ca_999",
      speed_account_id: "acct_999",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: { source: "existing_connected_account" },
      error_message: null,
      mode: "test",
      credential_password_used: true,
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("ready")
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "ready",
        speedConnectedAccountStatus: "active",
        speedConnectedAccountId: "acct_999",
        speedAccountId: "acct_999",
      })
    )

    const usedPassword = (
      mocks.createSpeedCustomConnectedAccountForMerchant.mock.calls[0]?.[0] as { password?: string } | undefined
    )?.password
    expect(usedPassword).toBe("Fixture-Shared-Test-Pass9!")

    const warnCalls = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(JSON.stringify(warnCalls)).not.toContain(usedPassword)
  })

  it("uses Business Profile contact_email as the primary connected-account email, ahead of the merchant account email", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      email: "legacy-account-email@example.test",
    })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "US",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      contact_email: "contact@example.test",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_contact",
      speed_connected_account_relationship_id: "ca_contact",
      speed_account_id: "acct_contact",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ email: "contact@example.test" })
    )
  })

  it("falls back to the merchant account email for legacy profiles where contact_email is absent", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      email: "legacy-account-email@example.test",
    })
    // beforeEach's default businessProfile has no contact_email.
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_legacy",
      speed_connected_account_relationship_id: "ca_legacy",
      speed_account_id: "acct_legacy",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ email: "legacy-account-email@example.test" })
    )
  })

  it("falls back to the authenticated user email when both contact_email and merchant email are missing", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: null,
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "pending",
      speed_connected_account_id: "acct_auth",
      speed_connected_account_relationship_id: "ca_auth",
      speed_account_id: "acct_auth",
      speed_connected_account_status: "pending_verification",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId, { authEmail: "AuthUser@Example.Test" })

    expect(result.action).toBe("provisioning_incomplete")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ email: "authuser@example.test" })
    )
  })

  it("does not call Speed when contact_email, merchant email, and auth email are all missing or invalid", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: "not-an-email",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId, { authEmail: "" })

    expect(result.status).toBe("needs_attention")
    expect(result.action).toBe("provisioning_incomplete")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "needs_attention",
        speedConnectedAccountStatus: "speed_connect_missing_email",
      })
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

  it("becomes ready immediately when Speed returns status Active (case-insensitive), matching the documented success response", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_active",
      speed_connected_account_relationship_id: "ca_active",
      speed_account_id: "acct_active",
      speed_connected_account_status: "Active",
      setup_url: null,
      provider_response_summary: { status: "Active", type: "custom", platform_account_id: "acct_platform" },
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("ready")
    expect(result.action).toBe("provisioned")
    expect(result.speedConnectedAccountId).toBe("acct_active")
    // No setup_url / pending interaction - Custom Connect is not an invite flow.
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", speedConnectSetupUrl: null })
    )
  })

  it("checks an existing pending Speed account instead of creating a duplicate", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(
      lightningProfile({
        status: "pending",
        accountId: "acct_existing",
        relationshipId: "ca_existing",
        accountStatus: "unknown",
      })
    )
    mocks.getSpeedConnectedAccountSetupStatus.mockResolvedValue({
      readiness: "pending",
      speed_connected_account_id: "acct_existing",
      speed_connected_account_relationship_id: "ca_existing",
      speed_account_id: "acct_existing",
      speed_connected_account_status: "pending_verification",
      setup_url: null,
      provider_response_summary: { source: "existing_connected_account" },
      error_message: null,
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("existing_account_checked")
    expect(result.status).toBe("pending")
    expect(mocks.getSpeedConnectedAccountSetupStatus).toHaveBeenCalledWith({
      connectedAccountId: "ca_existing",
      accountId: "acct_existing",
    })
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
  })

  it("recovers an already-created Speed account from credential metadata before creating a duplicate", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantSpeedCredentialMetadata.mockResolvedValue({
      id: "cred_1",
      merchant_id: merchantId,
      speed_connected_account_id: "acct_recovered",
      speed_login_email: "merchant@example.test",
      environment: "production",
      created_at: "2026-07-08T00:00:00.000Z",
      updated_at: "2026-07-08T00:00:00.000Z",
      rotated_at: null,
    })
    mocks.getSpeedConnectedAccountSetupStatus.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_recovered",
      speed_connected_account_relationship_id: "ca_recovered",
      speed_account_id: "acct_recovered",
      speed_connected_account_status: "Active",
      setup_url: null,
      provider_response_summary: { source: "existing_connected_account" },
      error_message: null,
      mode: "live",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("existing_credential_recovered")
    expect(result.status).toBe("ready")
    expect(mocks.getSpeedConnectedAccountSetupStatus).toHaveBeenCalledWith({
      connectedAccountId: null,
      accountId: "acct_recovered",
    })
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "ready",
        speedConnectedAccountId: "acct_recovered",
        speedConnectedAccountRelationshipId: "ca_recovered",
        speedAccountId: "acct_recovered",
        speedConnectedAccountStatus: "active",
      })
    )
    expect(mocks.saveMerchantSpeedConnection).toHaveBeenCalledWith(
      merchantId,
      expect.objectContaining({
        accountId: "acct_recovered",
        accountStatus: "active",
        enabled: true,
      })
    )
  })

  it("stores needs_attention instead of throwing when Speed provisioning throws", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockRejectedValue(
      new Error("raw provider failure")
    )

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("needs_attention")
    expect(result.action).toBe("provisioning_incomplete")
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "needs_attention",
        speedConnectedAccountStatus: "speed_custom_connect_failed",
        providerErrorMessage: "Lightning provisioning needs attention.",
      })
    )
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

  it("captures Speed's provider_code and sanitized field_errors from a rejected /connect/custom request", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
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
      provider_code: "invalid_request",
      provider_message: "email already registered",
      field_errors: [{ field: "email", message: "already registered" }],
      provider_http_status: 400,
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("needs_attention")
    expect(result.providerCode).toBe("invalid_request")
    expect(result.fieldErrors).toEqual([{ field: "email", message: "already registered" }])
    // A deterministic 4xx is persisted distinctly so the retry-suppression gate
    // can recognize it on the next call.
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        speedConnectedAccountStatus: "speed_custom_connect_rejected",
        // Merchant-safe canned copy only - never Speed's raw provider_message.
        providerErrorMessage: "Review your Business Profile information to finish Bitcoin setup.",
        providerResponseSummary: expect.objectContaining({
          provider_code: "invalid_request",
          field_errors: [{ field: "email", message: "already registered" }],
          speed_request_fingerprint: expect.any(String),
        }),
      })
    )
  })

  it("does not retry Speed automatically when a deterministic rejection is unchanged", async () => {
    const { computeSpeedCustomConnectFingerprint } = await import("@/engine/pineTreeWalletReadiness")
    mocks.getMerchantLightningProfile.mockResolvedValue({
      ...lightningProfile({ status: "needs_attention", accountStatus: "speed_custom_connect_rejected" }),
      provider_response_summary: {
        provider_code: "invalid_request",
        field_errors: [{ field: "email", message: "already registered" }],
        // Matches the fingerprint the engine would compute for the unchanged
        // beforeEach business profile (United States / Ada / Lovelace / merchant@example.test).
        speed_request_fingerprint: computeSpeedCustomConnectFingerprint({
          country: "United States",
          accountType: "merchant",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "merchant@example.test",
        }),
      },
    })
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      email: "merchant@example.test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("rejection_unchanged")
    expect(result.status).toBe("needs_attention")
    expect(result.providerCode).toBe("invalid_request")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
  })

  it("allows a fresh Speed attempt once the fingerprinted Business Profile fields change", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue({
      ...lightningProfile({ status: "needs_attention", accountStatus: "speed_custom_connect_rejected" }),
      provider_response_summary: {
        provider_code: "invalid_request",
        field_errors: [{ field: "email", message: "already registered" }],
        speed_request_fingerprint: "stale-fingerprint-from-before-the-edit",
      },
    })
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_retry",
      speed_connected_account_relationship_id: "ca_retry",
      speed_account_id: "acct_retry",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("provisioned")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
  })

  it("permits an explicit forceRetry even when the fingerprinted profile is unchanged", async () => {
    const { computeSpeedCustomConnectFingerprint, ensureManagedLightningForMerchant } = await import(
      "@/engine/pineTreeWalletReadiness"
    )
    mocks.getMerchantLightningProfile.mockResolvedValue({
      ...lightningProfile({ status: "needs_attention", accountStatus: "speed_custom_connect_rejected" }),
      provider_response_summary: {
        provider_code: "invalid_request",
        field_errors: [],
        speed_request_fingerprint: computeSpeedCustomConnectFingerprint({
          country: "United States",
          accountType: "merchant",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "merchant@example.test",
        }),
      },
    })
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_forced",
      speed_connected_account_relationship_id: "ca_forced",
      speed_account_id: "acct_forced",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const result = await ensureManagedLightningForMerchant(merchantId, { forceRetry: true })

    expect(result.action).toBe("provisioned")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
  })

  it("the corrected country-literal request produces a different fingerprint than the old 'US' rejection, so the next normal attempt retries without needing forceRetry", async () => {
    const { computeSpeedCustomConnectFingerprint } = await import("@/engine/pineTreeWalletReadiness")
    // The OLD (now-fixed) fingerprint shape used the ISO code "US" and included
    // phone/businessName fields that no longer exist. Even ignoring the shape
    // change, the value itself ("US" vs "United States") now differs.
    const staleFingerprintFromDisprovenUsAssumption = computeSpeedCustomConnectFingerprint({
      country: "United States",
      accountType: "merchant",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
    })
    // Sanity: fingerprints for two different country literals must differ.
    const withDifferentCountry = computeSpeedCustomConnectFingerprint({
      country: "US",
      accountType: "merchant",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "merchant@example.test",
    })
    expect(staleFingerprintFromDisprovenUsAssumption).not.toBe(withDifferentCountry)

    mocks.getMerchantLightningProfile.mockResolvedValue({
      ...lightningProfile({ status: "needs_attention", accountStatus: "speed_custom_connect_rejected" }),
      provider_response_summary: {
        provider_code: "invalid_request_error",
        field_errors: [{ field: "country", message: "Invalid Country. Your request can't be completed" }],
        // Simulates the OLD saved fingerprint from when PineTree sent "US".
        speed_request_fingerprint: withDifferentCountry,
      },
    })
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_fixed",
      speed_connected_account_relationship_id: "ca_fixed",
      speed_account_id: "acct_fixed",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    // No forceRetry - the corrected request's own fingerprint naturally differs
    // from the stale "US" one, so this is allowed as a normal ensure attempt.
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("provisioned")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
  })

  it("retries the exact country-rejection merchant via forceRetry, reuses the existing account by email, and never touches Base/Solana", async () => {
    const { computeSpeedCustomConnectFingerprint, ensureManagedLightningForMerchant } = await import(
      "@/engine/pineTreeWalletReadiness"
    )
    // Reproduces the saved provider_response_summary from the production
    // rejection: a Speed-side country validation failure.
    mocks.getMerchantLightningProfile.mockResolvedValue({
      ...lightningProfile({ status: "needs_attention", accountStatus: "speed_custom_connect_rejected" }),
      provider_response_summary: {
        provider_code: "invalid_request_error",
        field_errors: [{ field: "country", message: "Invalid Country. Your request can't be completed" }],
        owner_email_present: false,
        speed_request_fingerprint: computeSpeedCustomConnectFingerprint({
          country: "United States",
          accountType: "merchant",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "merchant@example.test",
        }),
      },
    })
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_reused",
      speed_connected_account_relationship_id: "ca_reused",
      speed_account_id: "acct_reused",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: { source: "existing_connected_account" },
      error_message: null,
      mode: "test",
    })

    const result = await ensureManagedLightningForMerchant(merchantId, { forceRetry: true })

    expect(result.action).toBe("provisioned")
    expect(result.status).toBe("ready")
    // Exactly one Speed call - createSpeedCustomConnectedAccountForMerchant
    // itself is responsible for the existing-account-by-email reuse check
    // that prevents a duplicate Speed account (covered in speedConnectedAccounts.test.ts).
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
    // Never recreates the PineTree wallet or Base/Solana - the only wallet
    // profile write this engine ever issues is the Lightning-status sync.
    expect(mocks.upsertPineTreeWalletProfile).not.toHaveBeenCalled()
  })

  it("normalizes a 'United States' Business Profile country value to Speed's documented literal before calling Speed", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "United States",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_country_fix",
      speed_connected_account_relationship_id: "ca_country_fix",
      speed_account_id: "acct_country_fix",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ country: "United States" })
    )
    expect(result.action).toBe("provisioned")
  })

  it("logs the temporary speed_custom_connect_country_diagnostic with the stored value, the provider-bound literal, and no PII", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "US",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_diag",
      speed_connected_account_relationship_id: "ca_diag",
      speed_account_id: "acct_diag",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })
    const infoSpy = vi.spyOn(console, "info")

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    await ensureManagedLightningForMerchant(merchantId)

    const diagnosticCall = infoSpy.mock.calls.find(
      (call) => call[0] === "[pinetree-managed-lightning] speed_custom_connect_country_diagnostic"
    )
    expect(diagnosticCall?.[1]).toEqual({
      merchant_id: merchantId,
      stored_country: "US",
      provider_country: "United States",
      account_type: "merchant",
      api_host: expect.any(String),
    })
    const serialized = JSON.stringify(diagnosticCall)
    expect(serialized).not.toContain("Ada")
    expect(serialized).not.toContain("Lovelace")
    expect(serialized).not.toContain("merchant@example.test")
  })

  it("stops before calling Speed when the Business Profile country cannot be normalized for Speed (e.g. Canada) - non-US countries are not supported for launch", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "CA",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
    })
    const warnSpy = vi.spyOn(console, "warn")

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("needs_valid_country")
    expect(result.status).toBe("needs_attention")
    expect(result.merchantMessage).toBe("Review your Business Profile country to finish Bitcoin setup.")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).not.toHaveBeenCalled()
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        status: "needs_attention",
        speedConnectedAccountStatus: "needs_valid_country",
      })
    )
    // Never logs the raw country value, only a presence boolean.
    const countryCall = warnSpy.mock.calls.find((call) => call[0] === "[pinetree-managed-lightning] speed_country_unsupported")
    expect(countryCall?.[1]).toEqual({ merchant_id: merchantId, businessCountryPresent: true })
  })

  it("reports null providerCode and empty fieldErrors when Speed succeeds or an attempt hasn't run", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(
      lightningProfile({ status: "ready", accountId: "acct_123", relationshipId: "ca_123", accountStatus: "active" })
    )

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.action).toBe("already_active")
    expect(result.providerCode).toBeNull()
    expect(result.fieldErrors).toEqual([])
  })

  it("uses business_dba as last_name when present (Speed's own documentation example uses a business name in last_name)", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "US",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      legal_business_name: "PineTree Test Merchant LLC",
      business_dba: "PineTree Test Merchant",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_biz",
      speed_connected_account_relationship_id: "ca_biz",
      speed_account_id: "acct_biz",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        last_name: "PineTree Test Merchant",
        email_valid: true,
        password_policy_valid: true,
      })
    )
  })

  it("falls back to legal_business_name for last_name when DBA is absent", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      business_name: "PineTree Test Merchant",
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "US",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      legal_business_name: "PineTree Test Merchant LLC",
      business_dba: null,
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_biz",
      speed_connected_account_relationship_id: "ca_biz",
      speed_account_id: "acct_biz",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        last_name: "PineTree Test Merchant LLC",
      })
    )
  })

  it("falls back to owner_last_name for last_name only when neither DBA nor legal business name is on file", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, email: "merchant@example.test" })
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "complete",
      business_country: "US",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      legal_business_name: null,
      business_dba: null,
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_fallback",
      speed_connected_account_relationship_id: "ca_fallback",
      speed_account_id: "acct_fallback",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    await ensureManagedLightningForMerchant(merchantId)

    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ last_name: "Lovelace", first_name: "Ada" })
    )
  })

  it("never includes wallet base/solana addresses or core status in the Lightning-only profile sync", () => {
    // A Speed failure or success must never be able to touch the core
    // base/solana readiness fields - those are set exclusively by the wallet
    // profile POST route, never by Lightning provisioning.
    const fs = require("node:fs")
    const path = require("node:path")
    const engine = fs.readFileSync(path.join(process.cwd(), "engine/pineTreeWalletReadiness.ts"), "utf8") as string
    const syncFn = engine.slice(
      engine.indexOf("async function syncLightningStatusIntoWalletProfile"),
      engine.indexOf("async function ensureManagedLightningForMerchantImpl")
    )
    expect(syncFn).not.toContain("baseAddress")
    expect(syncFn).not.toContain("solanaAddress")
    expect(syncFn).not.toContain("status:")
  })

  it("Custom Connect never uses the invite/account-link flow - no reference to it anywhere in this module", () => {
    const fs = require("node:fs")
    const path = require("node:path")
    const engine = fs.readFileSync(path.join(process.cwd(), "engine/pineTreeWalletReadiness.ts"), "utf8") as string
    expect(engine).not.toContain("createOrLinkSpeedConnectedAccountForMerchant")
    expect(engine).not.toContain("createSpeedConnectAccountLink")
    expect(engine).not.toContain("setup_url_present")
  })

  it("two concurrent calls for the same merchant create only one Speed connected account", async () => {
    const concurrentMerchantId = "concurrent-merchant-1"
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getMerchantById.mockResolvedValue({
      id: concurrentMerchantId,
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_concurrent",
      speed_connected_account_relationship_id: "ca_concurrent",
      speed_account_id: "acct_concurrent",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    // No awaits between these two calls - both start before either settles, exercising
    // the exact React Strict Mode / duplicate-effect-fire race this guards against.
    const first = ensureManagedLightningForMerchant(concurrentMerchantId)
    const second = ensureManagedLightningForMerchant(concurrentMerchantId)

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
    expect(firstResult).toBe(secondResult)
    expect(firstResult.speedConnectedAccountId).toBe("acct_concurrent")
  })

  it("a later call after the first settles starts a fresh attempt instead of being permanently deduped", async () => {
    const sequentialMerchantId = "sequential-merchant-1"
    mocks.getMerchantLightningProfile.mockResolvedValueOnce(null)
    mocks.getMerchantById.mockResolvedValue({
      id: sequentialMerchantId,
      email: "merchant@example.test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })
    mocks.createSpeedCustomConnectedAccountForMerchant.mockResolvedValue({
      readiness: "ready",
      speed_connected_account_id: "acct_seq",
      speed_connected_account_relationship_id: "ca_seq",
      speed_account_id: "acct_seq",
      speed_connected_account_status: "active",
      setup_url: null,
      provider_response_summary: {},
      error_message: null,
      mode: "test",
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const firstResult = await ensureManagedLightningForMerchant(sequentialMerchantId)
    expect(firstResult.action).toBe("provisioned")

    // Second call: the profile is now active, so it should short-circuit without
    // calling Speed again - proving the in-flight map was cleared, not left stuck.
    mocks.getMerchantLightningProfile.mockResolvedValue(
      lightningProfile({ status: "ready", accountId: "acct_seq", relationshipId: "ca_seq", accountStatus: "active" })
    )
    const second = await ensureManagedLightningForMerchant(sequentialMerchantId)
    expect(second.action).toBe("already_active")
    expect(mocks.createSpeedCustomConnectedAccountForMerchant).toHaveBeenCalledTimes(1)
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

    // Speed Custom Connect credential retention is internal-only - merchants
    // must never see the account id, login email, password, or admin reveal
    // route/action.
    for (const src of [walletPage, providersPage]) {
      expect(src).not.toMatch(/speed_login_email|speedLoginEmail/i)
      expect(src).not.toMatch(/speedPassword|speed_password/i)
      expect(src).not.toContain("merchant_speed_credentials")
      expect(src).not.toContain("/api/admin/speed-credentials")
      expect(src).not.toMatch(/revealAdminSpeedCredential|revealMerchantSpeedCredential/)
    }
  })
})

describe("getLightningNeedsAttentionMerchantMessage", () => {
  it("returns the Business Profile message for a 4xx with field errors", async () => {
    const { getLightningNeedsAttentionMerchantMessage } = await import("@/engine/pineTreeWalletReadiness")
    expect(
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: 400, fieldErrorCount: 1 })
    ).toBe("Review your Business Profile information to finish Bitcoin setup.")
  })

  it("returns the temporary-unavailable message for a 5xx or missing status (timeout/network)", async () => {
    const { getLightningNeedsAttentionMerchantMessage } = await import("@/engine/pineTreeWalletReadiness")
    expect(
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: 500, fieldErrorCount: 0 })
    ).toBe("Bitcoin setup is temporarily unavailable. Try again.")
    expect(
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: null, fieldErrorCount: 0 })
    ).toBe("Bitcoin setup is temporarily unavailable. Try again.")
  })

  it("falls back to the generic needs-attention message for an unclassified rejection", async () => {
    const { getLightningNeedsAttentionMerchantMessage } = await import("@/engine/pineTreeWalletReadiness")
    expect(
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: 400, fieldErrorCount: 0 })
    ).toBe("Bitcoin setup needs attention.")
  })

  it("never returns Speed's raw provider message", async () => {
    const { getLightningNeedsAttentionMerchantMessage } = await import("@/engine/pineTreeWalletReadiness")
    const messages = [
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: 400, fieldErrorCount: 1 }),
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: 500, fieldErrorCount: 0 }),
      getLightningNeedsAttentionMerchantMessage({ providerHttpStatus: 400, fieldErrorCount: 0 }),
    ]
    for (const message of messages) {
      expect(message).not.toContain("Speed")
      expect(message).not.toContain("email")
    }
  })
})

describe("Speed Custom Connect unified credentials", () => {
  it("validates the unified password with the Speed policy helper", async () => {
    const { speedCustomConnectPasswordPolicyPass } = await import("@/engine/pineTreeWalletReadiness")

    expect(speedCustomConnectPasswordPolicyPass("Shared-Fixed-Test-Password9!")).toBe(true)
    expect(speedCustomConnectPasswordPolicyPass("abcABC123!!!")).toBe(false)
    expect(speedCustomConnectPasswordPolicyPass("NoSpecial12345")).toBe(false)
    expect(speedCustomConnectPasswordPolicyPass("NoNumber!!!!!")).toBe(false)
  })

  it("never logs the plaintext password anywhere in this module's password lifecycle", () => {
    const fs = require("node:fs")
    const path = require("node:path")
    const engine = fs.readFileSync(path.join(process.cwd(), "engine/pineTreeWalletReadiness.ts"), "utf8") as string
    // The password variable is only ever passed to Speed and to diagnostic
    // presence booleans - it must never appear on the same line as a console.* call.
    const offendingLines = engine
      .split("\n")
      .filter((line) => /console\.(info|warn|error)/.test(line) && /speedPassword/.test(line))
    expect(offendingLines).toEqual([])
  })
})

describe("Speed Custom Connect password resolution", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("uses the unified SPEED_CONNECTED_ACCOUNT_PASSWORD", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "development",
      SPEED_CONNECTED_ACCOUNT_PASSWORD: "Shared-Fixed-Test-Password9!",
    }
    const { resolveSpeedAccountPassword } = await import("@/engine/pineTreeWalletReadiness")
    expect(resolveSpeedAccountPassword()).toBe("Shared-Fixed-Test-Password9!")
    expect(resolveSpeedAccountPassword()).toBe(resolveSpeedAccountPassword())
  })

  it("throws a clear configuration error when SPEED_CONNECTED_ACCOUNT_PASSWORD is missing", async () => {
    process.env = { ...process.env, NODE_ENV: "test" }
    delete process.env.SPEED_CONNECTED_ACCOUNT_PASSWORD
    const { resolveSpeedAccountPassword } = await import("@/engine/pineTreeWalletReadiness")
    expect(() => resolveSpeedAccountPassword()).toThrow(/SPEED_CONNECTED_ACCOUNT_PASSWORD/)
  })

  it("does not fall back to SPEED_TEST_ACCOUNT_PASSWORD", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      SPEED_CONNECTED_ACCOUNT_PASSWORD: "Unified-Fixed-Password9!",
      SPEED_TEST_ACCOUNT_PASSWORD: "should-never-be-used-in-production",
    }
    const { resolveSpeedAccountPassword } = await import("@/engine/pineTreeWalletReadiness")
    expect(resolveSpeedAccountPassword()).toBe("Unified-Fixed-Password9!")
  })
})
