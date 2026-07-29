import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { abandonPaymentIntentEngine, verifyCheckoutSession } = vi.hoisted(() => ({
  abandonPaymentIntentEngine: vi.fn(),
  verifyCheckoutSession: vi.fn(),
}))

vi.mock("@/engine/paymentIntents", () => ({
  abandonPaymentIntentEngine,
  PaymentAlreadySubmittedError: class PaymentAlreadySubmittedError extends Error {},
}))

vi.mock("@/lib/api/checkoutAuth", () => ({ verifyCheckoutSession }))

import { POST } from "@/app/api/payment-intents/[intentId]/abandon/route"

describe("payment intent abandon route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCheckoutSession.mockReturnValue({ iid: "intent-1" })
    abandonPaymentIntentEngine.mockResolvedValue(undefined)
  })

  it("ends a checkout-scoped pre-submission attempt with its correlation ID", async () => {
    const request = new NextRequest("https://example.test/api/payment-intents/intent-1/abandon", {
      method: "POST",
      headers: {
        Authorization: "Bearer pco_test",
        "X-PineTree-Correlation-Id": "attempt-123",
      },
    })

    const response = await POST(request, { params: Promise.resolve({ intentId: "intent-1" }) })

    expect(response.status).toBe(200)
    expect(abandonPaymentIntentEngine).toHaveBeenCalledWith("intent-1", "attempt-123")
  })

  it("rejects a checkout token scoped to a different intent", async () => {
    verifyCheckoutSession.mockReturnValue({ iid: "intent-other" })
    const request = new NextRequest("https://example.test/api/payment-intents/intent-1/abandon", {
      method: "POST",
      headers: { Authorization: "Bearer pco_test" },
    })

    const response = await POST(request, { params: Promise.resolve({ intentId: "intent-1" }) })

    expect(response.status).toBe(403)
    expect(abandonPaymentIntentEngine).not.toHaveBeenCalled()
  })
})
