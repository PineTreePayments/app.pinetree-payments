import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { requireV1MerchantApiKey, getPublicPayment } = vi.hoisted(() => ({
  requireV1MerchantApiKey: vi.fn(),
  getPublicPayment: vi.fn(),
}))

vi.mock("@/lib/api/v1/auth", () => ({ requireV1MerchantApiKey }))
vi.mock("@/engine/publicPayments", () => ({ getPublicPayment }))

import { GET } from "@/app/api/v1/payments/[id]/route"

describe("v1 public payment retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireV1MerchantApiKey.mockResolvedValue({
      merchantId: "merchant-1",
      permissions: ["payments:read"],
    })
  })

  it("returns only the normalized payment facade", async () => {
    getPublicPayment.mockResolvedValue({
      id: "payment-1",
      object: "payment",
      status: "paid",
      amount: 10,
      currency: "USD",
      network: "base",
      rail: "base",
      reference: "order-1",
      metadata: { cartId: "cart-1" },
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T01:00:00.000Z",
    })
    const request = new NextRequest("https://example.test/api/v1/payments/payment-1", {
      headers: { Authorization: "Bearer pt_live_valid" },
    })
    const result = await GET(request, { params: Promise.resolve({ id: "payment-1" }) })
    expect(result.status).toBe(200)
    await expect(result.json()).resolves.not.toHaveProperty("provider")
    expect(getPublicPayment).toHaveBeenCalledWith("merchant-1", "payment-1")
  })

  it("returns not found for cross-merchant or missing payments", async () => {
    getPublicPayment.mockResolvedValue(null)
    const request = new NextRequest("https://example.test/api/v1/payments/payment-2", {
      headers: { Authorization: "Bearer pt_live_valid" },
    })
    const result = await GET(request, { params: Promise.resolve({ id: "payment-2" }) })
    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "payment_not_found" },
    })
  })
})
