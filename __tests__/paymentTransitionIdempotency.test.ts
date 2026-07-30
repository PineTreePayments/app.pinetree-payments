import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  getPaymentByProviderReference: vi.fn(),
  updatePaymentStatus: vi.fn(),
  createPaymentEvent: vi.fn(),
  upsertLedgerEntry: vi.fn()
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEvents: vi.fn().mockResolvedValue([]),
  getPaymentEventByProviderEvent: vi.fn().mockResolvedValue(null)
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  getTransactionByProviderReference: vi.fn().mockResolvedValue(null),
  updateTransactionProviderReference: vi.fn(),
  updateTransactionStatus: vi.fn()
}))

vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: vi.fn().mockResolvedValue({ skipped: true })
}))

vi.mock("@/engine/webhookDelivery", () => ({
  deliverWebhook: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/providers/registry", () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
  setProviderHealth: vi.fn()
}))

import {
  createPaymentEvent,
  getPaymentById,
  updatePaymentStatus as updatePaymentStatusInDb
} from "@/database"
import { processPaymentEvent } from "@/engine/eventProcessor"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference,
} from "@/database/transactions"

const mockGetPayment = vi.mocked(getPaymentById)
const mockDbUpdate = vi.mocked(updatePaymentStatusInDb)
const mockCreateEvent = vi.mocked(createPaymentEvent)
const mockGetTransaction = vi.mocked(getTransactionByPaymentId)
const mockUpdateTransactionReference = vi.mocked(updateTransactionProviderReference)

const pendingPayment = {
  id: "pay-1",
  merchant_id: "merchant-1",
  merchant_amount: 10,
  pinetree_fee: 0.15,
  gross_amount: 10.15,
  currency: "USD",
  provider: "test",
  status: "PENDING" as const,
  network: "base",
  metadata: {
    split: {
      feeCaptureMethod: "direct",
      merchantWallet: "0xmerchant",
      pinetreeWallet: "0xtreasury"
    }
  },
  created_at: "2026-06-08T00:00:00.000Z",
  updated_at: "2026-06-08T00:00:00.000Z"
}

describe("overlapping payment transition idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPayment.mockResolvedValue(pendingPayment)
  })

  it("creates one lifecycle event when duplicate watcher results race", async () => {
    mockDbUpdate
      .mockResolvedValueOnce({ ...pendingPayment, status: "PROCESSING" })
      .mockRejectedValueOnce(new Error(
        "Concurrent payment transition skipped: payment status changed"
      ))

    const watcherEvent = {
      type: "payment.processing" as const,
      paymentId: "pay-1",
      txHash: "0xabc"
    }
    const results = await Promise.allSettled([
      processPaymentEvent(watcherEvent),
      processPaymentEvent(watcherEvent)
    ])

    expect(results.every((result) => result.status === "fulfilled")).toBe(true)
    expect(mockDbUpdate).toHaveBeenCalledWith("pay-1", "PROCESSING", "PENDING")
    expect(mockCreateEvent).toHaveBeenCalledTimes(1)
    expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      payment_id: "pay-1",
      event_type: "payment.processing"
    }))
  })

  it("records explicit cancellation distinctly from generic incomplete state", async () => {
    mockDbUpdate.mockResolvedValueOnce({ ...pendingPayment, status: "CANCELED" })

    await updatePaymentStatus("pay-1", "CANCELED", {
      providerEvent: "terminal_cancel",
      rawPayload: { reason: "merchant_canceled" }
    })

    expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      payment_id: "pay-1",
      event_type: "payment.canceled",
      provider_event: "terminal_cancel"
    }))
  })

  it("does not promote a rejected candidate hash to the canonical transaction reference", async () => {
    const processingPayment = { ...pendingPayment, status: "PROCESSING" as const }
    mockGetPayment.mockResolvedValue(processingPayment)
    mockGetTransaction.mockResolvedValue({
      id: "tx-1",
      payment_id: "pay-1",
      provider_transaction_id: null,
    } as never)
    mockDbUpdate.mockResolvedValueOnce({ ...processingPayment, status: "FAILED" })

    await processPaymentEvent({
      type: "payment.failed",
      paymentId: "pay-1",
      txHash: "0xrejected",
      rejectedEvidence: true,
      failureCode: "provider_evidence_mismatch",
      failureReason: "payment_reference_mismatch",
      failureDetails: { decodedPaymentRef: "another-payment" },
    })

    expect(mockUpdateTransactionReference).not.toHaveBeenCalled()
    expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "payment.failed",
      raw_payload: expect.objectContaining({
        rejectedEvidence: true,
        failureDetails: { decodedPaymentRef: "another-payment" },
      }),
    }))
  })

})
