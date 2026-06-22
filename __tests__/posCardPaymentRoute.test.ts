import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createPosPaymentIntentEngine: vi.fn(),
  createPosPaymentEngine: vi.fn(),
  requireTerminalSession: vi.fn()
}))

vi.mock("@/engine/posPayments", () => ({
  createPosPaymentIntentEngine: mocks.createPosPaymentIntentEngine,
  createPosPaymentEngine: mocks.createPosPaymentEngine
}))

vi.mock("@/lib/api/terminalAuth", () => ({
  requireTerminalSession: mocks.requireTerminalSession
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  getRouteErrorStatus: (error: { status?: number }) => error?.status || 500
}))

import { POST } from "@/app/api/pos/payment/route"

function cardRequest() {
  return new Request("https://app.pinetree-payments.test/api/pos/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 10, currency: "USD", network: "stripe" })
  })
}

describe("POS Stripe card payment route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireTerminalSession.mockReturnValue({ mid: "merchant_1", tid: "terminal_1" })
    mocks.createPosPaymentIntentEngine.mockResolvedValue({
      paymentId: "intent_1",
      intentId: "intent_1",
      paymentUrl: "https://app.pinetree-payments.test/pay?intent=intent_1",
      qrCodeUrl: "data:image/png;base64,qr",
      breakdown: { totalAmount: 10.15 }
    })
  })

  it("routes connected Stripe Card selection to a Stripe-only POS intent", async () => {
    const response = await POST(cardRequest() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.createPosPaymentIntentEngine).toHaveBeenCalledWith({
      amount: 10,
      currency: "USD",
      terminal: {
        merchantId: "merchant_1",
        terminalId: "terminal_1",
        preferredNetwork: "stripe"
      }
    })
    expect(mocks.createPosPaymentEngine).not.toHaveBeenCalled()
    expect(body.paymentUrl).toContain("/pay?intent=intent_1")
  })

  it("returns a visible readiness error instead of silently succeeding", async () => {
    mocks.createPosPaymentIntentEngine.mockRejectedValue(
      Object.assign(new Error("Card payments are not ready yet."), { status: 400 })
    )

    const response = await POST(cardRequest() as never)
    await expect(response.json()).resolves.toEqual({ error: "Card payments are not ready yet." })
    expect(response.status).toBe(400)
  })
})
