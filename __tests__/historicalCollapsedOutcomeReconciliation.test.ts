import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  updatePaymentStatus: vi.fn(),
  createPaymentEvent: vi.fn(),
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEvents: vi.fn(),
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn(),
  updateTransactionStatus: vi.fn(),
}))

import {
  createPaymentEvent,
  getPaymentById,
  updatePaymentStatus,
} from "@/database"
import { getPaymentEvents, type PaymentEvent } from "@/database/paymentEvents"
import {
  getTransactionByPaymentId,
  updateTransactionStatus,
} from "@/database/transactions"
import { reconcileHistoricalCollapsedPaymentOutcome } from "@/engine/paymentReconciliation"

const mockGetPayment = vi.mocked(getPaymentById)
const mockGetEvents = vi.mocked(getPaymentEvents)
const mockGetTransaction = vi.mocked(getTransactionByPaymentId)
const mockUpdatePayment = vi.mocked(updatePaymentStatus)
const mockCreateEvent = vi.mocked(createPaymentEvent)
const mockUpdateTransaction = vi.mocked(updateTransactionStatus)

function payment(status = "INCOMPLETE") {
  return {
    id: "pay-collapsed",
    merchant_id: "merchant-1",
    merchant_amount: 9.85,
    pinetree_fee: 0.15,
    gross_amount: 10,
    currency: "USD",
    provider: "base",
    provider_reference: "provider-payment-1",
    status,
    network: "base",
    metadata: { selectedAsset: "ETH" },
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:05:00.000Z",
  }
}

function event(
  eventType: PaymentEvent["event_type"],
  overrides: Partial<PaymentEvent> = {}
): PaymentEvent {
  return {
    id: `event-${eventType}`,
    payment_id: "pay-collapsed",
    event_type: eventType,
    provider_event: `provider-${eventType}`,
    raw_payload: { reason: eventType.includes("cancel") ? "merchant_canceled" : "invoice_expired" },
    created_at: "2026-07-20T12:05:00.000Z",
    ...overrides,
  }
}

describe("historical collapsed payment outcome reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPayment.mockResolvedValue(payment() as never)
    mockGetEvents.mockResolvedValue([event("payment.canceled")])
    mockGetTransaction.mockResolvedValue({
      id: "attempt-1",
      payment_id: "pay-collapsed",
      merchant_id: "merchant-1",
      provider: "base",
      provider_transaction_id: undefined,
      network: "base",
      status: "INCOMPLETE",
      created_at: "2026-07-20T12:00:30.000Z",
    })
    mockUpdatePayment.mockResolvedValue(payment("CANCELED") as never)
    mockCreateEvent.mockResolvedValue(event("payment.reconciled") as never)
  })

  it("defaults to a read-only dry run for an explicit INCOMPLETE payment", async () => {
    const originalEvents = [event("payment.canceled")]
    mockGetEvents.mockResolvedValue(originalEvents)

    const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed")

    expect(result).toMatchObject({
      paymentId: "pay-collapsed",
      mode: "dry-run",
      candidate: true,
      changed: false,
      idempotent: false,
      statusBefore: "INCOMPLETE",
      proposedStatus: "CANCELED",
      reason: "persisted_payment_canceled_event",
      evidence: {
        eventId: "event-payment.canceled",
        eventType: "payment.canceled",
        reason: "merchant_canceled",
      },
    })
    expect(mockUpdatePayment).not.toHaveBeenCalled()
    expect(mockCreateEvent).not.toHaveBeenCalled()
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
    expect(originalEvents).toEqual([event("payment.canceled")])
  })

  it.each([
    ["payment.canceled", "CANCELED", "persisted_payment_canceled_event"],
    ["payment.cancelled", "CANCELED", "persisted_payment_canceled_event"],
    ["payment.expired", "EXPIRED", "persisted_payment_expired_event"],
  ] as const)(
    "applies %s evidence through compare-and-set as %s and appends an audit event",
    async (eventType, target, reason) => {
      mockGetEvents.mockResolvedValue([event(eventType)])
      mockUpdatePayment.mockResolvedValue(payment(target) as never)

      const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })

      expect(result).toMatchObject({
        mode: "apply",
        candidate: true,
        changed: true,
        statusBefore: "INCOMPLETE",
        proposedStatus: target,
        reason,
      })
      expect(mockUpdatePayment).toHaveBeenCalledWith("pay-collapsed", target, "INCOMPLETE")
      expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
        payment_id: "pay-collapsed",
        event_type: "payment.reconciled",
        provider_event: "reconciliation.historical_collapsed_outcome",
        raw_payload: expect.objectContaining({
          oldValue: "INCOMPLETE",
          newValue: target,
          reason,
          evidenceSource: "persisted_payment_events",
          linkedTransactionStatusPreserved: "INCOMPLETE",
          evidence: expect.objectContaining({ eventType }),
        }),
      }))
      expect(mockUpdateTransaction).not.toHaveBeenCalled()
    }
  )

  it("uses the latest persisted explicit outcome event without replaying it as current state", async () => {
    mockGetEvents.mockResolvedValue([
      event("payment.canceled", { id: "cancel-old", created_at: "2026-07-20T12:03:00.000Z" }),
      event("payment.expired", { id: "expire-new", created_at: "2026-07-20T12:04:00.000Z" }),
    ])

    const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed")
    expect(result).toMatchObject({
      proposedStatus: "EXPIRED",
      evidence: { eventId: "expire-new", eventType: "payment.expired" },
    })
  })

  it.each([
    ["EXPIRED", "payment.expired"],
    ["CANCELED", "payment.canceled"],
    ["CANCELLED", "payment.cancelled"],
  ] as const)("is idempotent when %s already matches persisted %s evidence", async (status, eventType) => {
    mockGetPayment.mockResolvedValue(payment(status) as never)
    mockGetEvents.mockResolvedValue([event(eventType)])

    const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })
    expect(result).toMatchObject({
      candidate: true,
      changed: false,
      idempotent: true,
      proposedStatus: status === "CANCELLED" ? "CANCELED" : status,
      reason: "already_canonical_target",
    })
    expect(mockUpdatePayment).not.toHaveBeenCalled()
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it.each(["CREATED", "PENDING", "PROCESSING", "CONFIRMED", "FAILED"])(
    "refuses non-candidate stored status %s before reading evidence",
    async (status) => {
      mockGetPayment.mockResolvedValue(payment(status) as never)
      const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })

      expect(result).toMatchObject({ candidate: false, reason: "not_incomplete_or_canonical_target" })
      expect(mockGetEvents).not.toHaveBeenCalled()
      expect(mockUpdatePayment).not.toHaveBeenCalled()
    }
  )

  it.each(["payment.processing", "payment.confirmed", "payment.failed"] as const)(
    "refuses authoritative %s evidence",
    async (unsafeEventType) => {
      mockGetEvents.mockResolvedValue([
        event("payment.canceled"),
        event(unsafeEventType, { created_at: "2026-07-20T12:04:00.000Z" }),
      ])
      const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })

      expect(result).toMatchObject({
        candidate: false,
        reason: `unsafe_payment_event_evidence:${unsafeEventType}`,
      })
      expect(mockUpdatePayment).not.toHaveBeenCalled()
      expect(mockCreateEvent).not.toHaveBeenCalled()
    }
  )

  it("refuses a transaction hash or hash-bearing persisted event", async () => {
    mockGetTransaction.mockResolvedValue({
      id: "attempt-1",
      status: "INCOMPLETE",
      provider_transaction_id: "0xsubmitted-payment",
    } as never)
    await expect(reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })).resolves.toMatchObject({
      candidate: false,
      reason: "stored_transaction_hash_present",
    })

    mockGetTransaction.mockResolvedValue({ id: "attempt-1", status: "INCOMPLETE" } as never)
    mockGetEvents.mockResolvedValue([
      event("payment.canceled", { raw_payload: { reason: "merchant_canceled", txHash: "0xsubmitted" } }),
    ])
    await expect(reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })).resolves.toMatchObject({
      candidate: false,
      reason: "unsafe_payment_event_evidence:payment.canceled",
    })
    expect(mockUpdatePayment).not.toHaveBeenCalled()
  })

  it.each(["PROCESSING", "CONFIRMED", "FAILED", "REFUNDED"])(
    "refuses linked transaction status %s even without a stored hash",
    async (status) => {
      mockGetTransaction.mockResolvedValue({ id: "attempt-1", status } as never)
      const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })
      expect(result).toMatchObject({ candidate: false, reason: `unsafe_transaction_status:${status}` })
      expect(mockUpdatePayment).not.toHaveBeenCalled()
    }
  )

  it.each(["DISPUTED", "MYSTERY", "CREATED", "CANCELED"])(
    "fails closed on disputed or unknown linked transaction status %s",
    async (status) => {
      mockGetTransaction.mockResolvedValue({ id: "attempt-1", status } as never)
      const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })
      expect(result).toMatchObject({ candidate: false, reason: `unsafe_transaction_status:${status}` })
      expect(mockUpdatePayment).not.toHaveBeenCalled()
      expect(mockCreateEvent).not.toHaveBeenCalled()
    }
  )

  it("refuses missing evidence and conflicting already-canonical outcomes", async () => {
    mockGetEvents.mockResolvedValue([event("payment.incomplete")])
    await expect(reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed")).resolves.toMatchObject({
      candidate: false,
      reason: "no_authoritative_outcome_event",
    })

    mockGetPayment.mockResolvedValue(payment("EXPIRED") as never)
    mockGetEvents.mockResolvedValue([event("payment.canceled")])
    await expect(reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed")).resolves.toMatchObject({
      candidate: false,
      proposedStatus: "CANCELED",
      reason: "stored_target_conflicts_with_evidence",
    })
  })

  it("reports a compare-and-set race without appending a false audit event", async () => {
    mockUpdatePayment.mockRejectedValue(new Error("Concurrent payment transition skipped: payment status changed"))
    const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })

    expect(result).toMatchObject({
      candidate: true,
      changed: false,
      reason: "cas_failed:Concurrent payment transition skipped: payment status changed",
    })
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it("compensates with a CAS rollback when the audit event insert fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mockUpdatePayment
      .mockResolvedValueOnce(payment("CANCELED") as never)
      .mockResolvedValueOnce(payment("INCOMPLETE") as never)
    mockCreateEvent.mockRejectedValueOnce(new Error("payment_events insert unavailable"))

    const result = await reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })

    expect(mockUpdatePayment.mock.calls).toEqual([
      ["pay-collapsed", "CANCELED", "INCOMPLETE"],
      ["pay-collapsed", "INCOMPLETE", "CANCELED"],
    ])
    expect(result).toMatchObject({
      candidate: true,
      changed: false,
      reason: "audit_event_failed_rolled_back:payment_events insert unavailable",
    })
    expect(consoleError).toHaveBeenCalledWith(
      "[paymentReconciliation] audit append failed; correction rolled back",
      expect.objectContaining({ paymentId: "pay-collapsed" })
    )
    consoleError.mockRestore()
  })

  it("raises an explicit critical error if audit insertion and compensating rollback both fail", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mockUpdatePayment
      .mockResolvedValueOnce(payment("CANCELED") as never)
      .mockRejectedValueOnce(new Error("rollback compare-and-set lost"))
    mockCreateEvent.mockRejectedValueOnce(new Error("audit insert failed"))

    await expect(
      reconcileHistoricalCollapsedPaymentOutcome("pay-collapsed", { apply: true })
    ).rejects.toThrow(
      "CRITICAL_UNAUDITED_RECONCILIATION payment=pay-collapsed audit=audit insert failed rollback=rollback compare-and-set lost"
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[paymentReconciliation] CRITICAL unaudited correction rollback failed",
      expect.objectContaining({
        paymentId: "pay-collapsed",
        auditError: "audit insert failed",
        rollbackError: "rollback compare-and-set lost",
      })
    )
    consoleError.mockRestore()
  })
})

describe("bounded collapsed-outcome repair CLI", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts/reconcile-collapsed-payment-outcomes.mts"),
    "utf8"
  )

  it("requires explicit payment ids, defaults to dry-run, and has no incident-specific defaults", () => {
    expect(source).toContain("process.argv.slice(2)")
    expect(source).toContain('args.includes("--apply")')
    expect(source).toContain("paymentIds.length === 0")
    expect(source).toContain("reconcileHistoricalCollapsedPaymentOutcome(paymentId)")
    expect(source).toContain("reconcileHistoricalCollapsedPaymentOutcome(candidate.paymentId, { apply: true })")
    for (const incidentId of [
      "d19a5d69-d8fd-4be5-847a-2dff21333f68",
      "35666a2b-708d-4303-b3d1-08d143bbbb3b",
      "0db25894-81ba-4e75-bce1-339b8159f9ab",
    ]) {
      expect(source).not.toContain(incidentId)
    }
  })

  it("preflights the complete explicit batch and documents untouched events, transactions, and ledger", () => {
    expect(source).toContain("one_or_more_payment_ids_refused_preflight")
    expect(source).toContain("preservedRawEvents: true")
    expect(source).toContain("linkedTransactionsMutated: false")
    expect(source).toContain("ledgerWritesRequested: false")

    const engine = fs.readFileSync(path.join(process.cwd(), "engine/paymentReconciliation.ts"), "utf8")
    expect(engine).not.toContain("upsertLedgerEntry")
    expect(engine).not.toContain("updateTransactionStatus")
    expect(engine).not.toContain("reconcileTransactionForPayment")
  })
})
