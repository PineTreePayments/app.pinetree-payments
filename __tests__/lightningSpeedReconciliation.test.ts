import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  advancePaymentToTargetStatus: vi.fn(),
  processPaymentEvent: vi.fn(),
  retrieveMerchantSpeedPayment: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/engine/eventProcessor", () => ({
  advancePaymentToTargetStatus: mocks.advancePaymentToTargetStatus,
  processPaymentEvent: mocks.processPaymentEvent,
}))
vi.mock("@/providers/lightning/speedAdapter", () => ({
  retrieveMerchantSpeedPayment: mocks.retrieveMerchantSpeedPayment,
}))
// isSpeedPaymentPaid is a pure function - use the real implementation rather
// than re-deriving its "paid"/"confirmed" logic in a mock.
vi.mock("@/providers/lightning/speedClient", async () => {
  const actual = await vi.importActual<typeof import("@/providers/lightning/speedClient")>(
    "@/providers/lightning/speedClient"
  )
  return { isSpeedPaymentPaid: actual.isSpeedPaymentPaid }
})

import { reconcileSpeedLightningPayment } from "@/engine/lightningSpeedReconciliation"

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    merchant_id: "merchant-1",
    status: "PENDING",
    provider_reference: "speed_pay_123",
    ...overrides,
  } as never
}

describe("reconcileSpeedLightningPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPaymentById.mockResolvedValue(payment({ status: "PROCESSING" }))
  })

  it("advances a paid Speed invoice to CONFIRMED via the engine event processor", async () => {
    mocks.retrieveMerchantSpeedPayment.mockResolvedValue({ status: "paid" })

    const result = await reconcileSpeedLightningPayment(payment())

    expect(mocks.processPaymentEvent).toHaveBeenCalledWith({
      type: "payment.confirmed",
      paymentId: "pay-1",
      feeCaptureValidated: true,
    })
    expect(result.checked).toBe(true)
    expect(result.detected).toBe(true)
  })

  it("leaves a genuinely unpaid invoice alone - no status write for a still-open payment", async () => {
    mocks.retrieveMerchantSpeedPayment.mockResolvedValue({ status: "unpaid" })

    const result = await reconcileSpeedLightningPayment(payment())

    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
    expect(mocks.advancePaymentToTargetStatus).not.toHaveBeenCalled()
    expect(result.detected).toBe(false)
  })

  it("advances a detected-but-unsettled payment to PROCESSING", async () => {
    mocks.retrieveMerchantSpeedPayment.mockResolvedValue({ status: "processing" })

    await reconcileSpeedLightningPayment(payment())

    expect(mocks.processPaymentEvent).toHaveBeenCalledWith({
      type: "payment.processing",
      paymentId: "pay-1",
    })
  })

  it("advances an expired Speed invoice to INCOMPLETE with expiry evidence", async () => {
    mocks.retrieveMerchantSpeedPayment.mockResolvedValue({ status: "expired" })

    await reconcileSpeedLightningPayment(payment())

    expect(mocks.advancePaymentToTargetStatus).toHaveBeenCalledWith(
      "pay-1",
      "INCOMPLETE",
      expect.objectContaining({ providerEvent: "payment.expired" })
    )
  })

  it("never calls Speed for a payment that is already terminal locally (no downgrade risk)", async () => {
    const result = await reconcileSpeedLightningPayment(payment({ status: "CONFIRMED" }))

    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
    expect(result).toMatchObject({ checked: false, detected: false, status: "CONFIRMED" })
  })

  it("skips a payment with no Speed provider reference instead of throwing", async () => {
    const result = await reconcileSpeedLightningPayment(payment({ provider_reference: "" }))

    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
    expect(result.checked).toBe(false)
  })
})
