import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  getPaymentByProviderReference: vi.fn(),
  upsertLedgerEntry: vi.fn(),
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  getTransactionByProviderReference: vi.fn().mockResolvedValue(null),
  updateTransactionProviderReference: vi.fn(),
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEventByProviderEvent: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/engine/updatePaymentStatus", () => ({
  updatePaymentStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/engine/transactionProgress", () => ({
  syncTransactionProgressForPayment: vi.fn(),
}))

vi.mock("@/providers/registry", () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
  setProviderHealth: vi.fn(),
}))

import { getPaymentById } from "@/database"
import { processWebhook } from "@/engine/eventProcessor"
import {
  canTransition,
  isTerminalStatus,
  normalizeToStrictPaymentStatus,
} from "@/engine/paymentStateMachine"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"
import { getProvider } from "@/providers/registry"

const mockGetPayment = vi.mocked(getPaymentById)
const mockGetProvider = vi.mocked(getProvider)
const mockUpdate = vi.mocked(updatePaymentStatus)

const pendingPayment = {
  id: "pay-terminal-provider-event",
  merchant_id: "merchant-1",
  merchant_amount: 9.85,
  pinetree_fee: 0.15,
  gross_amount: 10,
  currency: "USD",
  provider: "test",
  provider_reference: "provider-payment-1",
  status: "PENDING" as const,
  network: "base",
  metadata: null,
  created_at: "2026-07-28T12:00:00.000Z",
  updated_at: "2026-07-28T12:01:00.000Z",
}

describe("provider terminal lifecycle persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPayment.mockResolvedValue(pendingPayment)
    mockGetProvider.mockReturnValue({
      verifyWebhook: () => true,
      translateEvent: (payload: unknown) => {
        const status = String((payload as { status?: string }).status || "").toLowerCase()
        return {
          paymentId: pendingPayment.id,
          event: status === "expired" ? "payment.expired" : "payment.canceled",
        }
      },
    } as never)
  })

  it.each([
    ["expired", "EXPIRED"],
    ["canceled", "CANCELED"],
    ["cancelled", "CANCELED"],
  ])("persists provider %s as distinct canonical %s", async (providerStatus, canonicalStatus) => {
    await processWebhook({
      provider: "test",
      payload: { id: `evt-${providerStatus}`, status: providerStatus },
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      pendingPayment.id,
      canonicalStatus,
      expect.objectContaining({ providerEvent: `evt-${providerStatus}` })
    )
    expect(mockUpdate).not.toHaveBeenCalledWith(
      pendingPayment.id,
      "INCOMPLETE",
      expect.anything()
    )
  })

  it("keeps EXPIRED and CANCELED as strict terminal state-machine values", () => {
    expect(normalizeToStrictPaymentStatus("EXPIRED")).toBe("EXPIRED")
    expect(normalizeToStrictPaymentStatus("CANCELED")).toBe("CANCELED")
    expect(normalizeToStrictPaymentStatus("CANCELLED")).toBe("CANCELED")
    expect(canTransition("PENDING", "EXPIRED" as never)).toBe(true)
    expect(canTransition("PENDING", "CANCELED" as never)).toBe(true)
    expect(isTerminalStatus("EXPIRED" as never)).toBe(true)
    expect(isTerminalStatus("CANCELED" as never)).toBe(true)
  })
})
