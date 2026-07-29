import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPaymentById: vi.fn(),
  advancePaymentToTargetStatus: vi.fn(),
  processPaymentEvent: vi.fn(),
  retrieveMerchantSpeedPayment: vi.fn(),
  retrieveSpeedPayment: vi.fn(),
  updatePaymentMetadata: vi.fn(),
}))

vi.mock("@/database", () => ({ getPaymentById: mocks.getPaymentById }))
vi.mock("@/database/payments", () => ({
  getPaymentById: mocks.getPaymentById,
  updatePaymentMetadata: mocks.updatePaymentMetadata,
}))
vi.mock("@/engine/eventProcessor", () => ({
  advancePaymentToTargetStatus: mocks.advancePaymentToTargetStatus,
  processPaymentEvent: mocks.processPaymentEvent,
}))
vi.mock("@/providers/lightning/speedAdapter", () => ({
  retrieveMerchantSpeedPayment: mocks.retrieveMerchantSpeedPayment,
}))
// Keep the real error class and pure status helper so 404 handling exercises
// the same instanceof and normalization paths as production.
vi.mock("@/providers/lightning/speedClient", async () => {
  const actual = await vi.importActual<typeof import("@/providers/lightning/speedClient")>(
    "@/providers/lightning/speedClient"
  )
  return {
    SpeedApiError: actual.SpeedApiError,
    isSpeedPaymentPaid: actual.isSpeedPaymentPaid,
    retrieveSpeedPayment: mocks.retrieveSpeedPayment,
  }
})

import { reconcileSpeedLightningPayment } from "@/engine/lightningSpeedReconciliation"
import { SpeedApiError } from "@/providers/lightning/speedClient"

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
    mocks.getPaymentById.mockResolvedValue(payment({ status: "PROCESSING", metadata: {} }))
    mocks.updatePaymentMetadata.mockResolvedValue(undefined)
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

  it("advances an expired Speed invoice to EXPIRED with expiry evidence", async () => {
    mocks.retrieveMerchantSpeedPayment.mockResolvedValue({ status: "expired" })

    await reconcileSpeedLightningPayment(payment())

    expect(mocks.advancePaymentToTargetStatus).toHaveBeenCalledWith(
      "pay-1",
      "EXPIRED",
      expect.objectContaining({ providerEvent: "payment.expired" })
    )
  })

  it("falls back to the legacy platform scope after a merchant-scoped 404", async () => {
    mocks.retrieveMerchantSpeedPayment.mockRejectedValue(
      new SpeedApiError("not found", 404, null, [])
    )
    mocks.retrieveSpeedPayment.mockResolvedValue({
      id: "speed_pay_123",
      status: "expired",
      metadata: {
        pineTreePaymentId: "pay-1",
        merchantId: "merchant-1",
      },
    })

    const result = await reconcileSpeedLightningPayment(payment())

    expect(mocks.retrieveSpeedPayment).toHaveBeenCalledWith("speed_pay_123")
    expect(mocks.updatePaymentMetadata).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({
        speedRetrieveStale: false,
        speedRetrieveScope: "legacy_platform",
      })
    )
    expect(mocks.advancePaymentToTargetStatus).toHaveBeenCalledWith(
      "pay-1",
      "EXPIRED",
      expect.objectContaining({
        providerEvent: "payment.expired",
        rawPayload: expect.objectContaining({ speedRetrievalScope: "legacy_platform" }),
      })
    )
    expect(result).toMatchObject({ checked: true, speedStatus: "expired" })
  })

  it("rechecks a stale flag written before legacy fallback support", async () => {
    mocks.getPaymentById.mockResolvedValue(payment({
      status: "PENDING",
      metadata: {
        speedRetrieveStale: true,
        speedRetrieveStaleReference: "speed_pay_123",
      },
    }))
    mocks.retrieveSpeedPayment.mockResolvedValue({
      id: "speed_pay_123",
      status: "paid",
      metadata: {
        pineTreePaymentId: "pay-1",
        merchantId: "merchant-1",
      },
    })

    await reconcileSpeedLightningPayment(payment())

    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
    expect(mocks.retrieveSpeedPayment).toHaveBeenCalledWith("speed_pay_123")
    expect(mocks.processPaymentEvent).toHaveBeenCalledWith({
      type: "payment.confirmed",
      paymentId: "pay-1",
      feeCaptureValidated: true,
    })
  })

  it("rejects a platform-scoped result whose canonical identities do not match", async () => {
    mocks.retrieveMerchantSpeedPayment.mockRejectedValue(
      new SpeedApiError("not found", 404, null, [])
    )
    mocks.retrieveSpeedPayment.mockResolvedValue({
      id: "speed_pay_123",
      status: "paid",
      metadata: {
        pineTreePaymentId: "another-payment",
        merchantId: "merchant-1",
      },
    })

    const result = await reconcileSpeedLightningPayment(payment())

    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
    expect(mocks.advancePaymentToTargetStatus).not.toHaveBeenCalled()
    expect(mocks.updatePaymentMetadata).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({
        speedRetrieveStale: true,
        speedRetrieveStaleReason: "platform_identity_mismatch",
      })
    )
    expect(result).toMatchObject({ detected: false, speedStatus: "stale_reference" })
  })

  it("does not repeatedly query a reference already checked in both scopes", async () => {
    mocks.getPaymentById.mockResolvedValue(payment({
      status: "PENDING",
      metadata: {
        speedRetrieveStale: true,
        speedLegacyPlatformFallbackCheckedAt: "2026-07-28T00:00:00.000Z",
      },
    }))

    const result = await reconcileSpeedLightningPayment(payment())

    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
    expect(mocks.retrieveSpeedPayment).not.toHaveBeenCalled()
    expect(result).toMatchObject({ checked: false, speedStatus: "stale_reference" })
  })

  it("never calls Speed for a payment that is already terminal locally (no downgrade risk)", async () => {
    const result = await reconcileSpeedLightningPayment(payment({ status: "CONFIRMED" }))

    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
    expect(result).toMatchObject({ checked: false, detected: false, status: "CONFIRMED" })
  })

  it("marks a payment with no Speed provider reference so it cannot starve the queue", async () => {
    const result = await reconcileSpeedLightningPayment(payment({ provider_reference: "" }))

    expect(mocks.retrieveMerchantSpeedPayment).not.toHaveBeenCalled()
    expect(mocks.updatePaymentMetadata).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({
        speedRetrieveStale: true,
        speedLegacyPlatformFallbackCheckedAt: expect.any(String),
        speedRetrieveStaleReason: "missing_provider_reference",
      })
    )
    expect(result.checked).toBe(false)
  })
})
