import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSweeps: vi.fn(),
  getSweepById: vi.fn(),
  retrySweep: vi.fn(),
  cancelSweep: vi.fn(),
}))

vi.mock("@/lib/api/adminAuth", () => ({
  requireAdminFromRequest: mocks.requireAdmin,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500,
}))

vi.mock("@/engine/adminLightningSweeps", () => ({
  getAdminLightningSweeps: mocks.getSweeps,
  getAdminLightningSweepById: mocks.getSweepById,
  retryAdminLightningSweep: mocks.retrySweep,
  cancelAdminLightningSweep: mocks.cancelSweep,
}))

import { GET as listGET } from "@/app/api/admin/lightning-sweeps/route"
import { GET as detailGET } from "@/app/api/admin/lightning-sweeps/[sweepId]/route"
import { POST as retryPOST } from "@/app/api/admin/lightning-sweeps/[sweepId]/retry/route"
import { POST as cancelPOST } from "@/app/api/admin/lightning-sweeps/[sweepId]/cancel/route"

function listRequest(query = "") {
  return new NextRequest(`https://app.test/api/admin/lightning-sweeps${query}`, {
    method: "GET",
    headers: { Authorization: "Bearer admin-token" },
  })
}

function actionRequest(sweepId: string) {
  return new NextRequest(`https://app.test/api/admin/lightning-sweeps/${sweepId}`, {
    method: "POST",
    headers: { Authorization: "Bearer admin-token" },
  })
}

function context(sweepId = "sweep_1") {
  return { params: Promise.resolve({ sweepId }) }
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "sweep_1",
    merchantId: "merchant_1",
    sourcePaymentId: "payment_1",
    speedConnectedAccountId: "acct_1",
    requestedAmountSats: 33333,
    feeReserveSats: 0,
    sentAmountSats: null,
    status: "awaiting_configuration",
    attemptCount: 0,
    nextAttemptAt: null,
    providerSendId: null,
    lastErrorCode: "feature_disabled",
    lastErrorMessage: "SPEED_LIGHTNING_SWEEP_ENABLED is not exactly \"true\".",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  }
}

describe("admin lightning-sweeps routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue("admin_1")
    mocks.getSweeps.mockResolvedValue([summary()])
    mocks.getSweepById.mockResolvedValue(summary())
    mocks.retrySweep.mockResolvedValue(summary({ status: "queued", lastErrorCode: null, lastErrorMessage: null }))
    mocks.cancelSweep.mockResolvedValue(summary({ status: "canceled" }))
  })

  describe("GET /api/admin/lightning-sweeps", () => {
    it("requires an admin", async () => {
      const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
      mocks.requireAdmin.mockRejectedValue(error)
      const response = await listGET(listRequest())
      expect(response.status).toBe(403)
      expect(mocks.getSweeps).not.toHaveBeenCalled()
    })

    it("returns sweep metadata with no-store caching, no secrets in the payload", async () => {
      const response = await listGET(listRequest("?merchantId=merchant_1"))
      expect(response.status).toBe(200)
      expect(response.headers.get("Cache-Control")).toContain("no-store")
      const body = await response.json()
      expect(body.sweeps).toEqual([summary()])
      expect(JSON.stringify(body)).not.toMatch(/destination_invoice|invoice_hash|speed_header_account_id|lnbc/i)
      expect(mocks.getSweeps).toHaveBeenCalledWith({ merchantId: "merchant_1", limit: undefined })
    })
  })

  describe("GET /api/admin/lightning-sweeps/[sweepId]", () => {
    it("requires an admin", async () => {
      const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
      mocks.requireAdmin.mockRejectedValue(error)
      const response = await detailGET(listRequest(), context())
      expect(response.status).toBe(403)
      expect(mocks.getSweepById).not.toHaveBeenCalled()
    })

    it("returns a single sweep summary", async () => {
      const response = await detailGET(listRequest(), context("sweep_1"))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.sweep.id).toBe("sweep_1")
    })

    it("surfaces a 404 when the sweep does not exist", async () => {
      mocks.getSweepById.mockRejectedValue(Object.assign(new Error("Lightning sweep not found"), { status: 404 }))
      const response = await detailGET(listRequest(), context("missing"))
      expect(response.status).toBe(404)
    })
  })

  describe("POST /api/admin/lightning-sweeps/[sweepId]/retry", () => {
    it("requires an admin before doing anything else", async () => {
      const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
      mocks.requireAdmin.mockRejectedValue(error)
      const response = await retryPOST(actionRequest("sweep_1"), context("sweep_1"))
      expect(response.status).toBe(403)
      expect(mocks.retrySweep).not.toHaveBeenCalled()
    })

    it("retries a sweep and returns the requeued state", async () => {
      const response = await retryPOST(actionRequest("sweep_1"), context("sweep_1"))
      expect(response.status).toBe(200)
      expect(mocks.retrySweep).toHaveBeenCalledWith({ sweepId: "sweep_1", adminId: "admin_1" })
      const body = await response.json()
      expect(body.sweep.status).toBe("queued")
    })

    it("propagates a 409 when the engine refuses to retry a confirmed sweep", async () => {
      mocks.retrySweep.mockRejectedValue(Object.assign(new Error("Cannot retry a confirmed sweep."), { status: 409 }))
      const response = await retryPOST(actionRequest("sweep_1"), context("sweep_1"))
      expect(response.status).toBe(409)
    })
  })

  describe("POST /api/admin/lightning-sweeps/[sweepId]/cancel", () => {
    it("requires an admin before doing anything else", async () => {
      const error = Object.assign(new Error("Forbidden: admin access required"), { status: 403 })
      mocks.requireAdmin.mockRejectedValue(error)
      const response = await cancelPOST(actionRequest("sweep_1"), context("sweep_1"))
      expect(response.status).toBe(403)
      expect(mocks.cancelSweep).not.toHaveBeenCalled()
    })

    it("cancels a sweep before it has been sent", async () => {
      const response = await cancelPOST(actionRequest("sweep_1"), context("sweep_1"))
      expect(response.status).toBe(200)
      expect(mocks.cancelSweep).toHaveBeenCalledWith({ sweepId: "sweep_1", adminId: "admin_1" })
      const body = await response.json()
      expect(body.sweep.status).toBe("canceled")
    })

    it("propagates a 409 when the engine refuses to cancel an already-sent sweep", async () => {
      mocks.cancelSweep.mockRejectedValue(
        Object.assign(new Error("Cannot cancel a sweep that has already been sent to the provider."), { status: 409 })
      )
      const response = await cancelPOST(actionRequest("sweep_1"), context("sweep_1"))
      expect(response.status).toBe(409)
    })
  })
})
