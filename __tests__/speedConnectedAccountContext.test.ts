import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMerchantLightningProfile: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
}))

import {
  resolveSpeedConnectedAccountContext,
  SpeedConnectedAccountContextError,
} from "@/providers/lightning/speedConnectedAccountContext"

function profile(overrides: Record<string, unknown> = {}) {
  return {
    merchant_id: "merchant_1",
    status: "ready",
    speed_account_id: "acct_live_123456",
    speed_header_account_id: null,
    speed_connected_account_relationship_id: "ca_relationship_123",
    speed_connected_account_status: "Active",
    ...overrides,
  }
}

describe("resolveSpeedConnectedAccountContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({
      platformAccountIdConfigured: true,
    })
    process.env.SPEED_PLATFORM_ACCOUNT_ID = "acct_platform_root"
  })

  it("returns the merchant acct_ account ID and never the ca_ relationship or platform account", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(profile())

    const context = await resolveSpeedConnectedAccountContext("merchant_1")

    expect(context).toMatchObject({
      merchantId: "merchant_1",
      connectedAccountId: "acct_live_123456",
      connectedRelationshipId: "ca_relationship_123",
      platformAccountId: "acct_platform_root",
      accountStatus: "Active",
      providerReady: true,
      maskedAccountSuffix: "123456",
    })
    expect(context.connectedAccountId).not.toBe(context.connectedRelationshipId)
    expect(context.connectedAccountId).not.toBe(context.platformAccountId)
  })

  it("rejects ca_ values when they would become the speed-account header", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(profile({
      speed_account_id: "ca_relationship_123",
    }))

    await expect(resolveSpeedConnectedAccountContext("merchant_1"))
      .rejects.toMatchObject({
        name: "SpeedConnectedAccountContextError",
        code: "SPEED_CONNECTED_ACCOUNT_INVALID",
      })
  })

  it("reports a precise missing-account context error before provider requests run", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(profile({
      speed_account_id: null,
    }))

    const error = await resolveSpeedConnectedAccountContext("merchant_1").catch((caught) => caught)

    expect(error).toBeInstanceOf(SpeedConnectedAccountContextError)
    expect(error).toMatchObject({
      code: "SPEED_CONNECTED_ACCOUNT_MISSING",
      merchantId: "merchant_1",
    })
  })

  it("fails safely when a merchant's connected account ID collides with PineTree's own platform account ID", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(profile({
      speed_account_id: "acct_platform_root",
    }))

    const error = await resolveSpeedConnectedAccountContext("merchant_1").catch((caught) => caught)

    expect(error).toBeInstanceOf(SpeedConnectedAccountContextError)
    expect(error).toMatchObject({
      code: "SPEED_CONNECTED_ACCOUNT_EQUALS_PLATFORM_ACCOUNT",
      merchantId: "merchant_1",
    })
  })
})
