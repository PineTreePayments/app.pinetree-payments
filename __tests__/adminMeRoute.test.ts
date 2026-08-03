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
      email: "jordanduskin@gmail.com",
      role: "admin",
    })

    const response = await GET(req({ authorization: "Bearer verified-session" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      isAdmin: true,
      merchantId: "admin-user-id",
      email: "jordanduskin@gmail.com",
      role: "admin",
      // Admin alone is not the Shift4 operator: SHIFT4_OPERATOR_EMAIL is unset
      // here, so the check fails closed.
      shift4Operator: false,
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
      shift4Operator: false,
    })
  })

  it("reports the Shift4 operator flag only for an admin with the configured email", async () => {
    // A synthetic address; never the real configured operator.
    vi.stubEnv("SHIFT4_OPERATOR_EMAIL", "operator@pinetree.test")

    mocks.getAdminStatusFromRequest.mockResolvedValue({
      isAdmin: true,
      merchantId: "admin-user-id",
      email: "operator@pinetree.test",
      verifiedEmail: "operator@pinetree.test",
      role: "admin",
    })
    await expect(
      (await GET(req({ authorization: "Bearer verified-session" }))).json()
    ).resolves.toMatchObject({ shift4Operator: true })

    // Another admin, same role, different address.
    mocks.getAdminStatusFromRequest.mockResolvedValue({
      isAdmin: true,
      merchantId: "other-admin-id",
      email: "second-admin@pinetree.test",
      verifiedEmail: "second-admin@pinetree.test",
      role: "admin",
    })
    await expect(
      (await GET(req({ authorization: "Bearer verified-session" }))).json()
    ).resolves.toMatchObject({ shift4Operator: false })

    // The configured address, but with no admin role.
    mocks.getAdminStatusFromRequest.mockResolvedValue({
      isAdmin: false,
      merchantId: "merchant-user-id",
      email: "operator@pinetree.test",
      verifiedEmail: "operator@pinetree.test",
      role: "merchant",
    })
    await expect(
      (await GET(req({ authorization: "Bearer merchant-session" }))).json()
    ).resolves.toMatchObject({ shift4Operator: false })

    vi.unstubAllEnvs()
  })

  it("never returns the configured operator address", async () => {
    vi.stubEnv("SHIFT4_OPERATOR_EMAIL", "operator@pinetree.test")
    mocks.getAdminStatusFromRequest.mockResolvedValue({
      isAdmin: false,
      merchantId: "merchant-user-id",
      email: "merchant@example.com",
      verifiedEmail: "merchant@example.com",
      role: "merchant",
    })

    const body = await (await GET(req({ authorization: "Bearer merchant-session" }))).json()

    expect(JSON.stringify(body)).not.toContain("operator@pinetree.test")
    vi.unstubAllEnvs()
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
