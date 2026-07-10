import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  getPaymentByProviderReference: vi.fn(),
  createPaymentEvent: vi.fn(),
  upsertLedgerEntry: vi.fn()
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn(),
  getTransactionByProviderReference: vi.fn(),
  updateTransactionProviderReference: vi.fn(),
  updateTransactionStatus: vi.fn()
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEventByProviderEvent: vi.fn()
}))

vi.mock("@/engine/updatePaymentStatus", () => ({
  updatePaymentStatus: vi.fn()
}))

vi.mock("@/engine/providerRegistry", () => ({
  getProvider: vi.fn()
}))

vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: vi.fn()
}))

vi.mock("@/engine/transactionProgress", () => ({
  syncTransactionProgressForPayment: vi.fn()
}))

import { advancePaymentToTargetStatus } from "@/engine/eventProcessor"
import { getPaymentById } from "@/database"
import { updatePaymentStatus } from "@/engine/updatePaymentStatus"
import {
  hasFailureEvidence,
  isExplicitUnpaidInvoiceExpiry,
  paymentHasProcessingEvidence
} from "@/engine/paymentEvidence"
import {
  canTransition,
  canUserCancelAsIncomplete
} from "@/engine/paymentStateMachine"
import { canonicalAdminPaymentStatus } from "@/engine/adminLedgerStatus"
import type { PaymentStatus } from "@/database/payments"

const mockGetPaymentById = vi.mocked(getPaymentById)
const mockUpdatePaymentStatus = vi.mocked(updatePaymentStatus)

function payment(status: PaymentStatus) {
  return {
    id: "pay-1",
    merchant_id: "merchant-1",
    merchant_amount: 10,
    pinetree_fee: 0.15,
    gross_amount: 10.15,
    currency: "USD",
    provider: "test",
    provider_reference: undefined,
    status,
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
}

describe("canonical payment lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Base transaction hash advances PENDING to PROCESSING then CONFIRMED", async () => {
    mockGetPaymentById.mockResolvedValue(payment("PENDING"))

    await advancePaymentToTargetStatus("pay-1", "CONFIRMED", {
      providerEvent: "watcher.detected",
      rawPayload: { txHash: "0xabc", feeCaptureValidated: true }
    })

    expect(mockUpdatePaymentStatus.mock.calls.map((call) => call[1])).toEqual([
      "PROCESSING",
      "CONFIRMED"
    ])
  })

  it("Base failed receipt advances PENDING through PROCESSING to FAILED", async () => {
    mockGetPaymentById.mockResolvedValue(payment("PENDING"))

    await advancePaymentToTargetStatus("pay-1", "FAILED", {
      providerEvent: "watcher.detected",
      rawPayload: { txHash: "0xabc", receiptStatus: "0x0", failureEvidence: true }
    })

    expect(mockUpdatePaymentStatus.mock.calls.map((call) => call[1])).toEqual([
      "PROCESSING",
      "FAILED"
    ])
  })

  it("Solana signature advances PENDING to PROCESSING then CONFIRMED", async () => {
    mockGetPaymentById.mockResolvedValue({
      ...payment("PENDING"),
      network: "solana"
    })

    await advancePaymentToTargetStatus("pay-1", "CONFIRMED", {
      providerEvent: "watcher.detected",
      rawPayload: { signature: "solana-signature", feeCaptureValidated: true }
    })

    expect(mockUpdatePaymentStatus.mock.calls.map((call) => call[1])).toEqual([
      "PROCESSING",
      "CONFIRMED"
    ])
  })

  it("Solana transaction error advances through PROCESSING to FAILED", async () => {
    mockGetPaymentById.mockResolvedValue({
      ...payment("PENDING"),
      network: "solana"
    })

    await advancePaymentToTargetStatus("pay-1", "FAILED", {
      providerEvent: "watcher.detected",
      rawPayload: {
        signature: "solana-signature",
        transactionError: "InstructionError"
      }
    })

    expect(mockUpdatePaymentStatus.mock.calls.map((call) => call[1])).toEqual([
      "PROCESSING",
      "FAILED"
    ])
  })

  it("requires CREATED to pass through PENDING before INCOMPLETE", () => {
    expect(canTransition("CREATED", "INCOMPLETE")).toBe(false)
    expect(canTransition("CREATED", "PENDING")).toBe(true)
    expect(canTransition("PENDING", "INCOMPLETE")).toBe(true)
  })
})

describe("payment evidence guards", () => {
  it("protects provider-referenced payments from stale cleanup", () => {
    expect(paymentHasProcessingEvidence({
      payment: { provider_reference: "charge-123", metadata: null },
      transaction: null,
      events: []
    })).toBe(true)
  })

  it("protects tx hashes, signatures, invoices, and processing events", () => {
    expect(paymentHasProcessingEvidence({
      payment: {
        provider_reference: undefined,
        metadata: { split: { signature: "sig-123" } }
      },
      transaction: null,
      events: []
    })).toBe(true)

    expect(paymentHasProcessingEvidence({
      payment: {
        provider_reference: undefined,
        metadata: { split: { lightningInvoice: "lnbc..." } }
      },
      transaction: null,
      events: []
    })).toBe(true)

    expect(paymentHasProcessingEvidence({
      payment: { provider_reference: undefined, metadata: null },
      transaction: null,
      events: [{ event_type: "payment.processing", raw_payload: null }]
    })).toBe(true)
  })

  it("does not treat UI rejection as provider failure evidence", () => {
    expect(hasFailureEvidence({
      providerEvent: "payment.user_rejected",
      rawPayload: { source: "ui_cancel" }
    })).toBe(false)
  })

  it("does not let a UI failure response choose FAILED for a processing payment", () => {
    expect(canUserCancelAsIncomplete("PROCESSING")).toBe(false)
    expect(canUserCancelAsIncomplete("PENDING")).toBe(true)
  })

  it("recognizes Lightning invoice expiry as unpaid INCOMPLETE evidence", () => {
    expect(isExplicitUnpaidInvoiceExpiry({
      providerEvent: "nwc_invoice_expired"
    })).toBe(true)
    expect(isExplicitUnpaidInvoiceExpiry({
      providerEvent: "payment.expired"
    })).toBe(true)
  })

  it("accepts provider or network failure proof", () => {
    expect(hasFailureEvidence({
      providerEvent: "charge:failed"
    })).toBe(true)
    expect(hasFailureEvidence({
      providerEvent: "watcher.detected",
      rawPayload: { receiptStatus: "0x0" }
    })).toBe(true)
    expect(hasFailureEvidence({
      providerEvent: "watcher.detected",
      rawPayload: { transactionError: "InstructionError" }
    })).toBe(true)
  })
})

describe("admin ledger status", () => {
  it("uses canonical payments.status without transaction-row inference", () => {
    expect(canonicalAdminPaymentStatus("PROCESSING")).toBe("PROCESSING")
    expect(canonicalAdminPaymentStatus("pending")).toBe("PENDING")
  })
})
