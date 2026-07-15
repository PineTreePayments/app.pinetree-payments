import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAdminStatusFromRequest: vi.fn(),
}))

vi.mock("@/lib/api/adminAuth", () => ({
  getAdminStatusFromRequest: mocks.getAdminStatusFromRequest,
  getRouteErrorStatus: (error: unknown, fallback = 500) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || fallback
      : fallback,
}))

import { GET } from "@/app/api/admin/me/route"

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://app.test/api/admin/me", { headers })
}

describe("/api/admin/me", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns admin status for the official account only", async () => {
    mocks.getAdminStatusFromRequest.mockResolvedValue({
      isAdmin: true,
      merchantId: "admin-user-id",
      email: "joshuaduskin@outlook.com",
      role: "admin",
    })

    const response = await GET(req({ authorization: "Bearer verified-session" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      isAdmin: true,
      merchantId: "admin-user-id",
      email: "joshuaduskin@outlook.com",
      role: "admin",
    })
  })

  it("does not expose role or email details for normal merchants", async () => {
    mocks.getAdminStatusFromRequest.mockResolvedValue({
      isAdmin: false,
      merchantId: "merchant-user-id",
      email: "merchant@example.com",
      role: "merchant",
    })

    const response = await GET(req({ authorization: "Bearer merchant-session" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      isAdmin: false,
      merchantId: "merchant-user-id",
      email: null,
      role: null,
    })
  })

  it("returns 401 for unauthenticated requests", async () => {
    mocks.getAdminStatusFromRequest.mockRejectedValue(
      Object.assign(new Error("Missing bearer token"), { status: 401 })
    )

    const response = await GET(req())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Missing bearer token" })
  })
})
