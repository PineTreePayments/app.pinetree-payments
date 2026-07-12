import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
  getMerchantBusinessProfile: vi.fn(),
  saveMerchantBusinessProfile: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

vi.mock("@/engine/businessProfile", () => ({
  getMerchantBusinessProfile: mocks.getMerchantBusinessProfile,
  saveMerchantBusinessProfile: mocks.saveMerchantBusinessProfile,
}))

function postRequest(body: unknown) {
  return new NextRequest("https://app.test/api/merchant/business-profile", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function getRequest() {
  return new NextRequest("https://app.test/api/merchant/business-profile", { method: "GET" })
}

describe("/api/merchant/business-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantIdFromRequest.mockResolvedValue(merchantId)
    mocks.getRouteErrorStatus.mockReturnValue(500)
  })

  it("loads the saved Business Profile without wallet provisioning", async () => {
    mocks.getMerchantBusinessProfile.mockResolvedValue({
      profile_status: "incomplete",
      legal_name: "PineTree Test",
    })

    const { GET } = await import("@/app/api/merchant/business-profile/route")
    const response = await GET(getRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.getMerchantBusinessProfile).toHaveBeenCalledWith(merchantId)
    expect(body.profile.profile_status).toBe("incomplete")
  })

  it("saves only Business Profile data even when the profile becomes complete", async () => {
    const input = {
      legal_name: "PineTree Test",
      owner_first_name: "Ada",
      owner_last_name: "Lovelace",
      business_country: "United States",
    }
    mocks.saveMerchantBusinessProfile.mockResolvedValue({
      ...input,
      profile_status: "complete",
    })

    const { POST } = await import("@/app/api/merchant/business-profile/route")
    const response = await POST(postRequest(input))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.saveMerchantBusinessProfile).toHaveBeenCalledWith(merchantId, input)
    expect(body.profile.profile_status).toBe("complete")
    expect(body.lightning).toBeUndefined()
    expect(body.speedConnectedAccountId).toBeUndefined()
  })
})
