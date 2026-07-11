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
  getSpeedConnectedAccountSetupStatus: vi.fn(),
  getMerchantBusinessProfile: vi.fn(),
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
  getSpeedConnectedAccountSetupStatus: mocks.getSpeedConnectedAccountSetupStatus,
}))

vi.mock("@/engine/businessProfile", () => ({
  getMerchantBusinessProfile: mocks.getMerchantBusinessProfile,
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
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
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
    expect(mocks.getMerchantBusinessProfile).toHaveBeenCalledWith(merchantId)
    // A password is required by Speed's API but is generated and never persisted/returned.
    const call = mocks.createSpeedCustomConnectedAccountForMerchant.mock.calls[0][0]
    expect(typeof call.password).toBe("string")
    expect(call.password.length).toBeGreaterThan(10)
    const { speedCustomConnectPasswordPolicyPass } = await import("@/engine/pineTreeWalletReadiness")
    expect(speedCustomConnectPasswordPolicyPass(call.password)).toBe(true)

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

  it("falls back to the authenticated user email when the merchant email is missing", async () => {
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

  it("does not call Speed when both merchant and auth emails are missing or invalid", async () => {
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
      field_errors: ["email: already registered"],
    })

    const { ensureManagedLightningForMerchant } = await import("@/engine/pineTreeWalletReadiness")
    const result = await ensureManagedLightningForMerchant(merchantId)

    expect(result.status).toBe("needs_attention")
    expect(result.providerCode).toBe("invalid_request")
    expect(result.fieldErrors).toEqual(["email: already registered"])
    // Persisted alongside the existing provider response summary so the saved
    // row is diagnosable, not just the request-time logs.
    expect(mocks.upsertMerchantLightningProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        providerResponseSummary: expect.objectContaining({
          provider_code: "invalid_request",
          field_errors: ["email: already registered"],
        }),
      })
    )
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

  it("passes DBA when present and pre-validated email/password policy booleans to Speed", async () => {
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
        business_name: "PineTree Test Merchant",
        email_valid: true,
        password_policy_valid: true,
      })
    )
  })

  it("uses legal business name as the Speed display fallback when DBA is absent", async () => {
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
        business_name: "PineTree Test Merchant LLC",
      })
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
      engine.indexOf("/**\n * Ensures a merchant's Lightning rail")
    )
    expect(syncFn).not.toContain("baseAddress")
    expect(syncFn).not.toContain("solanaAddress")
    expect(syncFn).not.toContain("status:")
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
  })
})

describe("Speed Custom Connect generated credentials", () => {
  it("generates passwords that always pass the Speed policy helper", async () => {
    const {
      generateSpeedCustomConnectPassword,
      speedCustomConnectPasswordPolicyPass,
    } = await import("@/engine/pineTreeWalletReadiness")

    for (let index = 0; index < 50; index += 1) {
      expect(speedCustomConnectPasswordPolicyPass(generateSpeedCustomConnectPassword())).toBe(true)
    }
    expect(speedCustomConnectPasswordPolicyPass("abcABC123!!!")).toBe(false)
    expect(speedCustomConnectPasswordPolicyPass("NoSpecial12345")).toBe(false)
    expect(speedCustomConnectPasswordPolicyPass("NoNumber!!!!!")).toBe(false)
  })
})
