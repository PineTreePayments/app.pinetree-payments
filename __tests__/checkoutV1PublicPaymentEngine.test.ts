import { describe, expect, it, vi } from "vitest"

const { getPublicPaymentById } = vi.hoisted(() => ({
  getPublicPaymentById: vi.fn(),
}))

vi.mock("@/database/payments", () => ({ getPublicPaymentById }))

import { getPublicPayment } from "@/engine/publicPayments"

describe("public payment normalization", () => {
  it("removes provider and wallet-sensitive metadata", async () => {
    getPublicPaymentById.mockResolvedValue({
      id: "payment-1",
      merchant_amount: 10,
      currency: "USD",
      status: "CONFIRMED",
      network: "base",
      metadata: {
        reference: "order-1",
        cartId: "cart-1",
        checkoutLinkId: "session-1",
        split: {
          merchantWallet: "0xmerchant",
          pinetreeWallet: "0xpinetree",
        },
      },
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T01:00:00.000Z",
    })

    const payment = await getPublicPayment("merchant-1", "payment-1")
    expect(payment).toMatchObject({
      object: "payment",
      status: "paid",
      reference: "order-1",
      metadata: { cartId: "cart-1" },
    })
    expect(payment?.metadata).not.toHaveProperty("split")
    expect(payment?.metadata).not.toHaveProperty("checkoutLinkId")
    expect(getPublicPaymentById).toHaveBeenCalledWith("payment-1", "merchant-1")
  })
})
