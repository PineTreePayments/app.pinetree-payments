import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantAuthFromRequest: vi.fn(),
  single: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantAuthFromRequest: mocks.requireMerchantAuthFromRequest,
  getRouteErrorStatus: (error: unknown, fallback = 500) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || fallback
      : fallback,
}))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mocks.single,
        }),
      }),
    }),
  },
  supabase: null,
}))

import { getAdminStatusFromRequest, requireAdminFromRequest } from "@/lib/api/adminAuth"

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://app.test/api/admin/overview", { headers })
}

describe("admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({
      merchantId: "admin-user-id",
      authUserId: "admin-user-id",
      email: "joshuaduskin@outlook.com",
      source: "supabase",
    })
    mocks.single.mockResolvedValue({
      data: { email: "joshuaduskin@outlook.com", role: "admin" },
      error: null,
    })
  })

  it("recognizes a Supabase user with the existing admin role", async () => {
    await expect(requireAdminFromRequest(req())).resolves.toBe("admin-user-id")
  })

  it("does not depend on email casing when the canonical admin role is present", async () => {
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({
      merchantId: "admin-user-id",
      authUserId: "admin-user-id",
      email: "JoshuaDuskin@Outlook.com",
      source: "supabase",
    })
    mocks.single.mockResolvedValue({
      data: { email: "JOSHUAduSKIN@outlook.com", role: "admin" },
      error: null,
    })

    await expect(requireAdminFromRequest(req())).resolves.toBe("admin-user-id")
  })

  it("denies a normal merchant even if a client supplies admin-looking headers", async () => {
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({
      merchantId: "merchant-user-id",
      authUserId: "merchant-user-id",
      email: "merchant@example.com",
      source: "supabase",
    })
    mocks.single.mockResolvedValue({
      data: { email: "merchant@example.com", role: "merchant" },
      error: null,
    })

    const status = await getAdminStatusFromRequest(req({
      "x-user-email": "joshuaduskin@outlook.com",
      "x-user-role": "admin",
    }))

    expect(status.isAdmin).toBe(false)
    await expect(requireAdminFromRequest(req())).rejects.toMatchObject({ status: 403 })
  })

  it("denies merchant API keys even when the merchant row has admin role", async () => {
    mocks.requireMerchantAuthFromRequest.mockResolvedValue({
      merchantId: "admin-user-id",
      authUserId: "admin-user-id",
      email: null,
      source: "api_key",
    })

    const status = await getAdminStatusFromRequest(req())

    expect(status.isAdmin).toBe(false)
    expect(mocks.single).not.toHaveBeenCalled()
  })

  it("fails closed when role data is missing", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null })

    const status = await getAdminStatusFromRequest(req())

    expect(status.isAdmin).toBe(false)
    await expect(requireAdminFromRequest(req())).rejects.toMatchObject({ status: 403 })
  })

  it("preserves unauthenticated requests as 401 from merchant auth", async () => {
    mocks.requireMerchantAuthFromRequest.mockRejectedValue(
      Object.assign(new Error("Missing bearer token"), { status: 401 })
    )

    await expect(requireAdminFromRequest(req())).rejects.toMatchObject({ status: 401 })
  })
})
