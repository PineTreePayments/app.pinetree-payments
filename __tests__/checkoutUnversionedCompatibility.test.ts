import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  requireMerchantIdFromRequest,
  createCheckoutSessionEngine,
} = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  createCheckoutSessionEngine: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest,
  getRouteErrorStatus: () => 500,
}))

vi.mock("@/engine/checkoutSessions", () => ({
  createCheckoutSessionEngine,
}))

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: null,
  supabase: {},
}))

import { POST } from "@/app/api/checkout/session/route"

describe("unversioned checkout session compatibility", () => {
  beforeEach(() => {
    requireMerchantIdFromRequest.mockReset()
    createCheckoutSessionEngine.mockReset()
  })

  it("keeps the existing wrapped { session } response contract", async () => {
    requireMerchantIdFromRequest.mockResolvedValue("merchant-1")
    const session = {
      sessionId: "session-1",
      token: "token-1",
      checkoutUrl: "https://example.test/checkout/token-1",
      amount: 10,
      currency: "USD",
      status: "active",
      expiresAt: null,
    }
    createCheckoutSessionEngine.mockResolvedValue(session)

    const req = new NextRequest("https://example.test/api/checkout/session", {
      method: "POST",
      headers: {
        Authorization: "Bearer dashboard-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: 10 }),
    })

    const response = await POST(req)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ session })
    expect(requireMerchantIdFromRequest).toHaveBeenCalledWith(
      req,
      "checkout.sessions:create"
    )
  })
})
