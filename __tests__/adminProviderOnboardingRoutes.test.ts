import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listOnboarding: vi.fn(),
  updateOnboarding: vi.fn()
}))

vi.mock("@/lib/api/adminAuth", () => ({
  requireAdminFromRequest: mocks.requireAdmin,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500
}))

vi.mock("@/engine/adminProviderOnboarding", () => ({
  listAdminProviderOnboarding: mocks.listOnboarding,
  updateAdminProviderOnboardingStatus: mocks.updateOnboarding
}))

import { GET, PATCH } from "@/app/api/admin/provider-onboarding/route"

function request(body?: unknown) {
  return new NextRequest("https://app.test/api/admin/provider-onboarding", {
    method: body ? "PATCH" : "GET",
    headers: {
      Authorization: "Bearer admin-token",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
}

describe("admin provider onboarding routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue("admin_1")
    mocks.listOnboarding.mockResolvedValue([])
    mocks.updateOnboarding.mockImplementation(({ merchantId, provider, applicationStatus }) => ({
      merchantId,
      provider,
      applicationStatus,
      status: applicationStatus === "approved" ? "active" : "denied",
      enabled: applicationStatus === "approved" && provider === "stripe"
    }))
  })

  it("allows admin to approve Stripe", async () => {
    const response = await PATCH(request({
      merchantId: "merchant_1",
      provider: "stripe",
      applicationStatus: "approved"
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: {
        merchantId: "merchant_1",
        provider: "stripe",
        applicationStatus: "approved",
        status: "active",
        enabled: true
      }
    })
    expect(mocks.updateOnboarding).toHaveBeenCalledWith({
      merchantId: "merchant_1",
      provider: "stripe",
      applicationStatus: "approved",
      adminId: "admin_1"
    })
  })

  it("allows admin to deny Stripe", async () => {
    const response = await PATCH(request({
      merchantId: "merchant_1",
      provider: "stripe",
      applicationStatus: "denied"
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: {
        provider: "stripe",
        applicationStatus: "denied",
        status: "denied",
        enabled: false
      }
    })
  })

  it("allows admin to approve Fluid Pay", async () => {
    const response = await PATCH(request({
      merchantId: "merchant_2",
      provider: "fluidpay",
      applicationStatus: "approved"
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: {
        merchantId: "merchant_2",
        provider: "fluidpay",
        applicationStatus: "approved"
      }
    })
  })

  it("allows admin to deny Fluid Pay", async () => {
    const response = await PATCH(request({
      merchantId: "merchant_2",
      provider: "fluidpay",
      applicationStatus: "denied"
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: {
        merchantId: "merchant_2",
        provider: "fluidpay",
        applicationStatus: "denied"
      }
    })
  })

  it("rejects non-admin updates", async () => {
    const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
    mocks.requireAdmin.mockRejectedValue(error)

    const response = await PATCH(request({
      merchantId: "merchant_1",
      provider: "stripe",
      applicationStatus: "approved"
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Forbidden: admin access required" })
    expect(mocks.updateOnboarding).not.toHaveBeenCalled()
  })

  it("lists provider onboarding rows for admins", async () => {
    mocks.listOnboarding.mockResolvedValue([
      { merchantId: "merchant_1", provider: "stripe", applicationStatus: "pending" }
    ])

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      providers: [{ merchantId: "merchant_1", provider: "stripe", applicationStatus: "pending" }]
    })
  })
})
