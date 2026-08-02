import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireMerchant: vi.fn(),
  runFixture: vi.fn(),
  executeOperation: vi.fn(),
}))

vi.mock("@/lib/api/adminAuth", () => ({ requireAdminFromRequest: mocks.requireAdmin }))
vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchant,
  getRouteErrorStatus: (error: unknown, fallback = 500) => {
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") return error.status
    return fallback
  },
}))
vi.mock("@/engine/shift4/readiness", () => ({
  readShift4FeatureFlags: () => ({ certificationMode: true }),
}))
vi.mock("@/engine/shift4/certificationService", () => ({
  SHIFT4_CERTIFICATION_WORKFLOWS: { ecommerce: ["EC-01"] },
  runShift4CertificationFixture: mocks.runFixture,
}))
vi.mock("@/engine/shift4/services", () => ({
  assertOperationName: () => "sale",
  executeMerchantShift4Operation: mocks.executeOperation,
}))

import { POST as certificationPost } from "@/app/api/admin/shift4/certification/route"
import { POST as paymentPost } from "@/app/api/internal/shift4/payments/[operation]/route"

const statusError = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, code })
const request = (url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => new NextRequest(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
})

describe("Shift4 route authentication, tenancy, and adapter contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue("admin-merchant")
    mocks.requireMerchant.mockResolvedValue("merchant-a")
    mocks.runFixture.mockResolvedValue({ cases: [], providerRequestsSent: 0 })
    mocks.executeOperation.mockResolvedValue({ attemptId: "attempt-safe", outcome: "approved" })
  })

  it("rejects an unauthenticated admin request with the standard envelope", async () => {
    mocks.requireAdmin.mockRejectedValue(statusError("Missing bearer token", 401, "unauthorized"))
    const response = await certificationPost(request("http://localhost/api/admin/shift4/certification", { mode: "fixture", channel: "all" }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "unauthorized", message: "Missing bearer token", correlationId: expect.any(String) }),
    })
  })

  it("rejects malformed merchant authentication before a production operation", async () => {
    mocks.requireMerchant.mockRejectedValue(statusError("Unauthorized", 401, "unauthorized"))
    const response = await paymentPost(request("http://localhost/api/internal/shift4/payments/sale", {}, { authorization: "Bearer malformed" }), { params: Promise.resolve({ operation: "sale" }) })
    expect(response.status).toBe(401)
    expect(mocks.executeOperation).not.toHaveBeenCalled()
  })

  it("does not allow a merchant user to call the admin fixture route", async () => {
    mocks.requireAdmin.mockRejectedValue(statusError("Forbidden: admin access required", 403, "forbidden"))
    const response = await certificationPost(request("http://localhost/api/admin/shift4/certification", { mode: "fixture", channel: "all" }))
    expect(response.status).toBe(403)
    expect(mocks.runFixture).not.toHaveBeenCalled()
  })

  it("prevents a fixture request from selecting a real adapter", async () => {
    const response = await certificationPost(request("http://localhost/api/admin/shift4/certification", { mode: "fixture", channel: "all", adapter: "real" }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: expect.objectContaining({ code: "invalid_adapter" }) })
    expect(mocks.runFixture).not.toHaveBeenCalled()
  })

  it("prevents a production route from selecting the simulator", async () => {
    const response = await paymentPost(request("http://localhost/api/internal/shift4/payments/sale", { adapter: "simulator" }, { "idempotency-key": "idem-1" }), { params: Promise.resolve({ operation: "sale" }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: expect.objectContaining({ code: "invalid_adapter" }) })
    expect(mocks.executeOperation).not.toHaveBeenCalled()
  })

  it("returns a cross-merchant service rejection without provider or database internals", async () => {
    mocks.executeOperation.mockRejectedValue(statusError("Cross-merchant payment ID rejected", 403, "merchant_scope_mismatch"))
    const response = await paymentPost(request("http://localhost/api/internal/shift4/payments/sale", {
      merchantProviderConnectionId: "connection-other-tenant",
      paymentId: "payment-other-tenant",
      channel: "ecommerce",
      amountMinor: 100,
      currency: "USD",
    }, { "idempotency-key": "idem-2" }), { params: Promise.resolve({ operation: "sale" }) })
    const text = await response.text()
    expect(response.status).toBe(403)
    expect(text).toContain("merchant_scope_mismatch")
    expect(text).not.toMatch(/serviceRoleKey|postgres|providerResponse|databaseRow/)
  })

  it("replaces an internal failure with the safe route fallback", async () => {
    mocks.executeOperation.mockRejectedValue(new Error("postgres serviceRoleKey=SECRET providerResponse=raw"))
    const response = await paymentPost(request("http://localhost/api/internal/shift4/payments/sale", {
      merchantProviderConnectionId: "connection-safe",
      paymentId: "payment-safe",
      channel: "ecommerce",
      amountMinor: 100,
      currency: "USD",
    }, { "idempotency-key": "idem-3" }), { params: Promise.resolve({ operation: "sale" }) })
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(text).toContain("Shift4 payment operation failed")
    expect(text).not.toMatch(/serviceRoleKey|SECRET|providerResponse|postgres/)
  })
})
