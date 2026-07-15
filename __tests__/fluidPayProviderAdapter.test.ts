import { describe, expect, it } from "vitest"

import {
  FLUIDPAY_UNVERIFIED_DOCS_ERROR,
  createPayment,
  getPaymentStatus,
  translateEvent,
  verifyWebhook
} from "@/providers/fluidpay"

describe("Fluid Pay provider scaffold", () => {
  it("fails closed for payment creation without verified official docs", async () => {
    await expect(createPayment({
      paymentId: "pay_123",
      merchantAmount: 10,
      pinetreeFee: 0.15,
      grossAmount: 10.15,
      currency: "USD",
      merchantId: "merchant_1"
    })).rejects.toThrow(FLUIDPAY_UNVERIFIED_DOCS_ERROR)
  })

  it("fails closed for status and webhooks without verified official docs", async () => {
    await expect(getPaymentStatus("fluid_123")).rejects.toThrow(FLUIDPAY_UNVERIFIED_DOCS_ERROR)
    expect(verifyWebhook()).toBe(false)
    expect(translateEvent()).toBeNull()
  })
})
