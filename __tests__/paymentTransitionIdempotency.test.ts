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
  getProvider: vi.fn()
}))

import {
  createPaymentEvent,
  getPaymentById,
  updatePaymentStatus as updatePaymentStatusInDb
} from "@/database"
import { processPaymentEvent } from "@/engine/eventProcessor"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"

const mockGetPayment = vi.mocked(getPaymentById)
const mockDbUpdate = vi.mocked(updatePaymentStatusInDb)
const mockCreateEvent = vi.mocked(createPaymentEvent)

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
    mockDbUpdate.mockResolvedValueOnce({ ...pendingPayment, status: "INCOMPLETE" })

    await updatePaymentStatus("pay-1", "INCOMPLETE", {
      providerEvent: "terminal_cancel",
      rawPayload: { reason: "merchant_canceled" }
    })

    expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      payment_id: "pay-1",
      event_type: "payment.cancelled",
      provider_event: "terminal_cancel"
    }))
  })
})
