import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSummary: vi.fn(),
  revealCredential: vi.fn(),
}))

vi.mock("@/lib/api/adminAuth", () => ({
  requireAdminFromRequest: mocks.requireAdmin,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500,
}))

vi.mock("@/engine/adminSpeedCredentials", () => ({
  getAdminSpeedCredentialSummary: mocks.getSummary,
  revealAdminSpeedCredential: mocks.revealCredential,
}))

import { GET } from "@/app/api/admin/speed-credentials/route"
import { POST } from "@/app/api/admin/speed-credentials/[merchantId]/reveal/route"

function listRequest(merchantId?: string) {
  const url = merchantId
    ? `https://app.test/api/admin/speed-credentials?merchantId=${merchantId}`
    : "https://app.test/api/admin/speed-credentials"
  return new NextRequest(url, {
    method: "GET",
    headers: { Authorization: "Bearer admin-token" },
  })
}

function revealRequest(body?: unknown) {
  return new NextRequest("https://app.test/api/admin/speed-credentials/merchant_1/reveal", {
    method: "POST",
    headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
}

function revealContext(merchantId = "merchant_1") {
  return { params: Promise.resolve({ merchantId }) }
}

describe("admin speed-credentials routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue("admin_1")
    mocks.getSummary.mockResolvedValue({
      merchantId: "merchant_1",
      environment: "non_production",
      status: "available",
      speedConnectedAccountId: "acct_1",
      speedLoginEmail: "merchant@example.test",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
      rotatedAt: null,
    })
    mocks.revealCredential.mockResolvedValue({
      speedConnectedAccountId: "acct_1",
      speedLoginEmail: "merchant@example.test",
      speedPassword: "the-real-speed-password",
    })
  })

  describe("GET /api/admin/speed-credentials", () => {
    it("requires merchantId", async () => {
      const response = await GET(listRequest())
      expect(response.status).toBe(400)
    })

    it("returns non-secret metadata for an admin, with no-store caching", async () => {
      const response = await GET(listRequest("merchant_1"))
      expect(response.status).toBe(200)
      expect(response.headers.get("Cache-Control")).toContain("no-store")
      const body = await response.json()
      expect(body.credential).toMatchObject({ merchantId: "merchant_1", status: "available" })
      expect(JSON.stringify(body)).not.toContain("speedPassword")
      expect(JSON.stringify(body).toLowerCase()).not.toContain("password")
    })

    it("rejects a non-admin caller", async () => {
      const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
      mocks.requireAdmin.mockRejectedValue(error)

      const response = await GET(listRequest("merchant_1"))
      expect(response.status).toBe(403)
      expect(mocks.getSummary).not.toHaveBeenCalled()
    })
  })

  describe("POST /api/admin/speed-credentials/[merchantId]/reveal", () => {
    it("requires an authenticated admin before doing anything else", async () => {
      const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
      mocks.requireAdmin.mockRejectedValue(error)

      const response = await POST(revealRequest({ confirm: true }), revealContext())
      expect(response.status).toBe(403)
      expect(mocks.revealCredential).not.toHaveBeenCalled()
    })

    it("rejects a reveal without explicit confirm:true", async () => {
      const response = await POST(revealRequest({}), revealContext())
      expect(response.status).toBe(400)
      expect(mocks.revealCredential).not.toHaveBeenCalled()
    })

    it("rejects confirm as a truthy non-boolean, not just falsy values", async () => {
      const response = await POST(revealRequest({ confirm: "true" }), revealContext())
      expect(response.status).toBe(400)
      expect(mocks.revealCredential).not.toHaveBeenCalled()
    })

    it("reveals the credential for an authorized admin with explicit confirmation, never caching the response", async () => {
      const response = await POST(revealRequest({ confirm: true }), revealContext("merchant_1"))

      expect(response.status).toBe(200)
      expect(response.headers.get("Cache-Control")).toContain("no-store")
      const body = await response.json()
      expect(body.credential.speedPassword).toBe("the-real-speed-password")
      expect(mocks.revealCredential).toHaveBeenCalledWith({ merchantId: "merchant_1", adminId: "admin_1" })
    })

    it("surfaces a clear error and 500 when there is no retained credential to reveal", async () => {
      mocks.revealCredential.mockRejectedValue(new Error("No retained Speed credential is available for this merchant/environment."))
      const response = await POST(revealRequest({ confirm: true }), revealContext())
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toMatch(/No retained Speed credential/)
    })
  })
})
