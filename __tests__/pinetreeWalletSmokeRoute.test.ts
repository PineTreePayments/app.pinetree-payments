import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const adminId = "9b2f7c40-6f21-4f0e-a2ce-1f19ab7d20aa"

const mocks = vi.hoisted(() => ({
  requireAdminFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
}))

vi.mock("@/lib/api/adminAuth", () => ({
  requireAdminFromRequest: mocks.requireAdminFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

function request(query = "") {
  return new NextRequest(`https://app.test/api/debug/pinetree-wallet/smoke${query}`, { method: "GET" })
}

const readyProfile = {
  id: "profile-1",
  merchant_id: adminId,
  merchant_email: "merchant@example.com",
  dynamic_email: "merchant@example.com",
  dynamic_user_id: "dyn_1234567890",
  base_address: "0x1234567890abcdef1234567890abcdef12345678",
  solana_address: "5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCiK1HL7v",
  status: "ready",
}

const lightningProfile = {
  id: "lightning-1",
  merchant_id: adminId,
  status: "pending",
  speed_account_id: "acct_secret_id",
  btc_address: "lnbc1secretinvoiceaddress",
}

describe("GET /api/debug/pinetree-wallet/smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv("NODE_ENV", "test")
    mocks.requireAdminFromRequest.mockResolvedValue(adminId)
    mocks.getRouteErrorStatus.mockReturnValue(500)
    mocks.getPineTreeWalletProfile.mockResolvedValue(readyProfile)
    mocks.getMerchantLightningProfile.mockResolvedValue(lightningProfile)
  })

  it("requires an authenticated admin", async () => {
    mocks.requireAdminFromRequest.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))
    mocks.getRouteErrorStatus.mockReturnValue(401)

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.getPineTreeWalletProfile).not.toHaveBeenCalled()
  })

  it("reports safe wallet setup state for the requested merchant", async () => {
    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request(`?merchant_id=${adminId}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      profileExists: true,
      profileStatus: "ready",
      profileHasBaseAddress: true,
      profileHasSolanaAddress: true,
      lightningStatus: "pending",
      dynamicAuthMode: expect.any(String),
      externalJwtEnabled: expect.any(Boolean),
    })
  })

  it("reports missing profiles as null statuses", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)
    mocks.getMerchantLightningProfile.mockResolvedValue(null)

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profileExists).toBe(false)
    expect(body.profileStatus).toBeNull()
    expect(body.profileHasBaseAddress).toBe(false)
    expect(body.profileHasSolanaAddress).toBe(false)
    expect(body.lightningStatus).toBeNull()
  })

  it("never leaks emails, wallet addresses, Dynamic IDs, Speed fields, or secrets", async () => {
    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())
    const raw = JSON.stringify(await response.json())

    expect(raw).not.toContain("merchant@example.com")
    expect(raw).not.toContain("@")
    expect(raw).not.toContain("0x1234567890abcdef")
    expect(raw).not.toContain("5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCiK1HL7v")
    expect(raw).not.toContain("dyn_1234567890")
    expect(raw).not.toContain("acct_secret_id")
    expect(raw).not.toContain("lnbc1")
    expect(raw.toLowerCase()).not.toContain("jwt\":")
    expect(raw.toLowerCase()).not.toContain("password")
  })

  it("is disabled in production unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PINETREE_WALLET_DEBUG_SMOKE_ENABLED", "false")
    vi.stubEnv("NEXT_PUBLIC_WALLET_DEBUG_EVENTS", "false")

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(mocks.requireAdminFromRequest).not.toHaveBeenCalled()
  })

  it("stays available in production when PINETREE_WALLET_DEBUG_SMOKE_ENABLED is true", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PINETREE_WALLET_DEBUG_SMOKE_ENABLED", "true")

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())

    expect(response.status).toBe(200)
  })
})
