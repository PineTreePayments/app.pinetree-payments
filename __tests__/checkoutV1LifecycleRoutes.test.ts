import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  requireV1MerchantApiKeyWithAnyPermission,
  transitionCheckoutSessionLifecycle,
  CheckoutSessionLifecycleError,
} = vi.hoisted(
  () => {
    class LifecycleError extends Error {
      constructor(
        readonly reason: "not_found" | "not_open",
        message: string
      ) {
        super(message)
      }
    }
    return {
    requireV1MerchantApiKeyWithAnyPermission: vi.fn(),
    transitionCheckoutSessionLifecycle: vi.fn(),
      CheckoutSessionLifecycleError: LifecycleError,
    }
  }
)

vi.mock("@/lib/api/v1/auth", () => ({
  requireV1MerchantApiKeyWithAnyPermission,
}))

vi.mock("@/engine/checkoutSessionLifecycle", () => ({
  CheckoutSessionLifecycleError,
  transitionCheckoutSessionLifecycle,
}))
import { POST as cancelSession } from "@/app/api/v1/checkout/sessions/[id]/cancel/route"
import { POST as expireSession } from "@/app/api/v1/checkout/sessions/[id]/expire/route"

const session = {
  id: "session-1",
  object: "checkout.session",
  status: "canceled",
  amount: 49.99,
  currency: "USD",
  reference: null,
  customer: { email: null },
  metadata: {},
  checkoutUrl: "https://example.test/checkout/token",
  paymentId: null,
  supportedRails: ["base"],
  successUrl: null,
  cancelUrl: null,
  createdAt: "2026-06-12T00:00:00.000Z",
  expiresAt: "2026-06-13T00:00:00.000Z",
}

function request(path: string) {
  return new NextRequest(`https://example.test${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer pt_live_valid" },
  })
}

describe("v1 checkout session lifecycle routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireV1MerchantApiKeyWithAnyPermission.mockResolvedValue({
      merchantId: "merchant-1",
      keyId: "key-1",
      permissions: ["checkout.sessions:create"],
    })
  })

  it("returns the normalized canceled session", async () => {
    transitionCheckoutSessionLifecycle.mockResolvedValue(session)
    const response = await cancelSession(
      request("/api/v1/checkout/sessions/session-1/cancel"),
      { params: Promise.resolve({ id: "session-1" }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: "checkout.session",
      status: "canceled",
    })
    expect(requireV1MerchantApiKeyWithAnyPermission).toHaveBeenCalledWith(
      expect.any(NextRequest),
      ["checkout.sessions:write", "checkout.sessions:create"]
    )
  })

  it("returns the normalized expired session", async () => {
    transitionCheckoutSessionLifecycle.mockResolvedValue({
      ...session,
      status: "expired",
    })
    const response = await expireSession(
      request("/api/v1/checkout/sessions/session-1/expire"),
      { params: Promise.resolve({ id: "session-1" }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: "expired" })
  })

  it.each([
    ["cancel", cancelSession, "checkout_session_not_cancelable"],
    ["expire", expireSession, "checkout_session_not_expirable"],
  ])("returns the v1 error contract when a paid session cannot %s", async (
    operation,
    handler,
    code
  ) => {
    transitionCheckoutSessionLifecycle.mockRejectedValue(
      new CheckoutSessionLifecycleError(
        "not_open",
        `Checkout session is paid and cannot be ${operation}.`
      )
    )
    const response = await handler(
      request(`/api/v1/checkout/sessions/session-1/${operation}`),
      { params: Promise.resolve({ id: "session-1" }) }
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: "invalid_request_error",
        code,
        requestId: expect.any(String),
      },
    })
  })

  it("returns checkout_session_not_found for an unknown session", async () => {
    transitionCheckoutSessionLifecycle.mockRejectedValue(
      new CheckoutSessionLifecycleError("not_found", "Checkout session not found.")
    )
    const response = await cancelSession(
      request("/api/v1/checkout/sessions/missing/cancel"),
      { params: Promise.resolve({ id: "missing" }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: "not_found_error",
        code: "checkout_session_not_found",
      },
    })
  })
})
