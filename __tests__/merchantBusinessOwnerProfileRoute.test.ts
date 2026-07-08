import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
  getMerchantById: vi.fn(),
  updateMerchantBusinessOwnerProfile: vi.fn(),
  ensureManagedLightningForMerchant: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

vi.mock("@/database/merchants", () => ({
  getMerchantById: mocks.getMerchantById,
  getMerchantBusinessOwnerProfile: (
    merchant: { owner_first_name?: string | null; owner_last_name?: string | null; business_country?: string | null } | null | undefined
  ) => {
    const ownerFirstName = String(merchant?.owner_first_name || "").trim()
    const ownerLastName = String(merchant?.owner_last_name || "").trim()
    const businessCountry = String(merchant?.business_country || "").trim().toUpperCase()
    if (!ownerFirstName || !ownerLastName || !businessCountry) return null
    return { ownerFirstName, ownerLastName, businessCountry }
  },
  updateMerchantBusinessOwnerProfile: mocks.updateMerchantBusinessOwnerProfile,
}))

vi.mock("@/engine/pineTreeWalletReadiness", () => ({
  ensureManagedLightningForMerchant: mocks.ensureManagedLightningForMerchant,
}))

function postRequest(body: unknown) {
  return new NextRequest("https://app.test/api/merchant/business-owner-profile", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function getRequest() {
  return new NextRequest("https://app.test/api/merchant/business-owner-profile", { method: "GET" })
}

describe("GET /api/merchant/business-owner-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue(merchantId)
    mocks.getRouteErrorStatus.mockReturnValue(500)
  })

  it("returns null when the business owner profile has not been saved yet", async () => {
    mocks.getMerchantById.mockResolvedValue({ id: merchantId, owner_first_name: null, owner_last_name: null, business_country: null })

    const { GET } = await import("@/app/api/merchant/business-owner-profile/route")
    const response = await GET(getRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profile).toBeNull()
  })

  it("returns the saved profile fields", async () => {
    mocks.getMerchantById.mockResolvedValue({
      id: merchantId,
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "US",
    })

    const { GET } = await import("@/app/api/merchant/business-owner-profile/route")
    const response = await GET(getRequest())
    const body = await response.json()

    expect(body.profile).toEqual({ ownerFirstName: "Ada", ownerLastName: "Lovelace", businessCountry: "US" })
  })
})

describe("POST /api/merchant/business-owner-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue(merchantId)
    mocks.getRouteErrorStatus.mockReturnValue(500)
    mocks.updateMerchantBusinessOwnerProfile.mockResolvedValue({ id: merchantId })
    mocks.ensureManagedLightningForMerchant.mockResolvedValue({
      status: "ready",
      action: "provisioned",
      speedConnectedAccountId: "acct_123",
      speedConnectedAccountRelationshipId: "ca_123",
      speedConnectedAccountStatus: "active",
    })
  })

  it("rejects missing first name", async () => {
    const { POST } = await import("@/app/api/merchant/business-owner-profile/route")
    const response = await POST(postRequest({ owner_last_name: "Lovelace", business_country: "US" }))
    expect(response.status).toBe(400)
    expect(mocks.updateMerchantBusinessOwnerProfile).not.toHaveBeenCalled()
  })

  it("rejects an invalid country code", async () => {
    const { POST } = await import("@/app/api/merchant/business-owner-profile/route")
    const response = await POST(
      postRequest({ owner_first_name: "Ada", owner_last_name: "Lovelace", business_country: "USA" })
    )
    expect(response.status).toBe(400)
    expect(mocks.updateMerchantBusinessOwnerProfile).not.toHaveBeenCalled()
  })

  it("saves the profile and triggers ensureManagedLightningForMerchant", async () => {
    const { POST } = await import("@/app/api/merchant/business-owner-profile/route")
    const response = await POST(
      postRequest({ owner_first_name: "Ada", owner_last_name: "Lovelace", business_country: "us" })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.updateMerchantBusinessOwnerProfile).toHaveBeenCalledWith(merchantId, {
      ownerFirstName: "Ada",
      ownerLastName: "Lovelace",
      businessCountry: "US",
    })
    expect(mocks.ensureManagedLightningForMerchant).toHaveBeenCalledWith(merchantId)
    expect(body.lightning.action).toBe("provisioned")
    expect(JSON.stringify(body)).not.toContain("password")
  })
})
