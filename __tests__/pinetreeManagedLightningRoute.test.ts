import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  requireMerchantAuthFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  ensureManagedLightningForMerchant: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  isSpeedPlatformTreasurySweepEnabled: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest,
  requireMerchantAuthFromRequest: mocks.requireMerchantAuthFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
  SPEED_PLATFORM_TREASURY_SWEEP_MODE: "speed_platform_treasury_sweep",
}))

vi.mock("@/engine/pineTreeWalletReadiness", () => ({
  ensureManagedLightningForMerchant: mocks.ensureManagedLightningForMerchant,
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
  relationshipId?: string | null
  accountStatus?: string | null
}) {
  return {
    id: "mlp_1",
    merchant_id: merchantId,
    provider: "speed",
    status: input.status,
    speed_connected_account_id: input.accountId ?? null,
    speed_connected_account_relationship_id: input.relationshipId ?? null,
    speed_account_id: input.accountId ?? null,
    speed_connected_account_status: input.accountStatus ?? input.status,
    speed_connect_setup_url: input.setupUrl ?? null,
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
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({ merchantId, email: "auth@example.test", source: "supabase" })
    mocks.getRouteErrorStatus.mockReturnValue(500)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  it("delegates provisioning to ensureManagedLightningForMerchant and returns the resulting profile", async () => {
    mocks.ensureManagedLightningForMerchant.mockResolvedValue({
      status: "ready",
      action: "provisioned",
      speedConnectedAccountId: "acct_123",
      speedConnectedAccountRelationshipId: "ca_123",
      speedConnectedAccountStatus: "active",
    })
    mocks.getMerchantLightningProfile.mockResolvedValue(
      savedProfile({ status: "ready", accountId: "acct_123", relationshipId: "ca_123", accountStatus: "active" })
    )

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.ensureManagedLightningForMerchant).toHaveBeenCalledWith(merchantId, { authEmail: "auth@example.test" })
    expect(body.profile.status).toBe("ready")
    expect(body.profile.speed_connected_account_id).toBe("acct_123")
    expect(body.profile.speed_connected_account_relationship_id).toBe("ca_123")
    expect(JSON.stringify(body)).not.toContain("sk_test")
    expect(JSON.stringify(body)).not.toContain("sk_live")
  })

  it("returns pending/needs_attention profiles from the ensure-function without failing the request", async () => {
    mocks.ensureManagedLightningForMerchant.mockResolvedValue({
      status: "needs_attention",
      action: "needs_business_owner_profile",
      speedConnectedAccountId: null,
      speedConnectedAccountRelationshipId: null,
      speedConnectedAccountStatus: "business_owner_profile_required",
    })
    mocks.getMerchantLightningProfile.mockResolvedValue(
      savedProfile({ status: "needs_attention", accountStatus: "business_owner_profile_required" })
    )

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profile.status).toBe("needs_attention")
    expect(body.setup_status).toBe("needs_attention")
  })

  it("returns a sanitized retryable status when provider provisioning fails", async () => {
    mocks.ensureManagedLightningForMerchant.mockRejectedValue(
      new Error("Speed secret provider failure: sk_live_do_not_expose")
    )
    mocks.getMerchantLightningProfile.mockResolvedValue(null)

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.setup_status).toBe("retryable")
    expect(body.message).toBe("Wallet setup is still processing. Please try again shortly.")
    expect(JSON.stringify(body)).not.toContain("Speed")
    expect(JSON.stringify(body)).not.toContain("sk_live")
  })

  it("stops waiting and returns retryable when provider provisioning hangs", async () => {
    vi.useFakeTimers()
    try {
      mocks.ensureManagedLightningForMerchant.mockReturnValue(new Promise(() => undefined))
      mocks.getMerchantLightningProfile.mockResolvedValue(null)

      const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
      const responsePromise = POST(request())
      await vi.advanceTimersByTimeAsync(12_001)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.setup_status).toBe("retryable")
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns 500 when the merchant JWT/session cannot be resolved", async () => {
    mocks.requireMerchantAuthFromRequest.mockRejectedValue(new Error("no session"))
    mocks.getRouteErrorStatus.mockReturnValue(401)

    const { POST } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mocks.ensureManagedLightningForMerchant).not.toHaveBeenCalled()
  })
})

describe("GET /api/wallets/lightning/pinetree-managed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue(merchantId)
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({ merchantId, email: "auth@example.test", source: "supabase" })
    mocks.getRouteErrorStatus.mockReturnValue(500)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
  })

  it("treasury-sweep mode synthesizes status from the wallet profile without calling the ensure-function", async () => {
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(true)
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({ configured: true, missing: [] })
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "wallet_1",
      merchant_id: merchantId,
      btc_address: "bc1ptestmerchant",
      btc_payout_enabled: true,
    })

    const { GET } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profile.status).toBe("ready")
    expect(mocks.ensureManagedLightningForMerchant).not.toHaveBeenCalled()
  })

  it("non-treasury-sweep mode returns the saved merchant_lightning_profiles row as-is", async () => {
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.getMerchantLightningProfile.mockResolvedValue(
      savedProfile({ status: "ready", accountId: "acct_123", relationshipId: "ca_123", accountStatus: "active" })
    )

    const { GET } = await import("@/app/api/wallets/lightning/pinetree-managed/route")
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profile.status).toBe("ready")
    expect(mocks.ensureManagedLightningForMerchant).not.toHaveBeenCalled()
  })
})
