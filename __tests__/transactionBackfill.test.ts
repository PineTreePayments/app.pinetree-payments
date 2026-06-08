/**
 * Tests for engine/transactionBackfill.ts
 *
 * Covers the 8 scenarios required by the backfill spec:
 *   1. FAILED payment + provider_transaction_id → transaction updated to FAILED
 *   2. CONFIRMED payment + already-CONFIRMED transaction → skipped (no downgrade)
 *   3. Stale PENDING with no evidence → marked INCOMPLETE via state-action flow
 *   4. Stale PENDING with provider reference → skipped (evidence guard)
 *   5. PROCESSING payment is never targeted by either query phase
 *   6a. INCOMPLETE payment, transaction has no evidence → synced to INCOMPLETE
 *   6b. INCOMPLETE payment, transaction has provider_transaction_id → skipped
 *   7. Dry-run mode makes zero DB writes
 *   8. Phase 1 does not create lifecycle payment_events for transaction-row repairs
 *
 * Run: npx vitest run __tests__/transactionBackfill.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoist the Supabase mock before any module is imported ────────────────────
// vi.hoisted() runs during the hoisting phase so `mockFrom` is available
// when the vi.mock factory function below is evaluated.
const mockFrom = vi.hoisted(() => vi.fn())

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: { from: mockFrom },
  supabase: null,
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn(),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEvents: vi.fn().mockResolvedValue([]),
  createPaymentEvent: vi.fn().mockResolvedValue({ id: "evt-001" }),
}))

vi.mock("@/engine/reconcileTransaction", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    reconcileTransactionForPayment: vi.fn(),
  }
})

vi.mock("@/engine/paymentStateActions", () => ({
  getPaymentIncompleteEligibility: vi.fn(),
  markPaymentIncomplete: vi.fn(),
}))

// @/engine/paymentEvidence is intentionally NOT mocked — we want the real
// evidence guard logic to run so tests that pass a provider_transaction_id
// on the transaction object exercise the actual check.

// ── Imports (after mock declarations) ────────────────────────────────────────

import { getTransactionByPaymentId } from "@/database/transactions"
import { getPaymentEvents, createPaymentEvent } from "@/database/paymentEvents"
import { reconcileTransactionForPayment } from "@/engine/reconcileTransaction"
import {
  getPaymentIncompleteEligibility,
  markPaymentIncomplete,
} from "@/engine/paymentStateActions"
import { runTransactionBackfill } from "@/engine/transactionBackfill"
import type { Transaction, TransactionStatus } from "@/database/transactions"

// ── Aliased mock references ───────────────────────────────────────────────────

const mockGetTransactionByPaymentId = vi.mocked(getTransactionByPaymentId)
const mockGetPaymentEvents = vi.mocked(getPaymentEvents)
const mockCreatePaymentEvent = vi.mocked(createPaymentEvent)
const mockReconcile = vi.mocked(reconcileTransactionForPayment)
const mockGetEligibility = vi.mocked(getPaymentIncompleteEligibility)
const mockMarkIncomplete = vi.mocked(markPaymentIncomplete)

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Build a Supabase chainable query that resolves with `data`. */
function makeDbChain(data: unknown[]) {
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
  }
  chain.select.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  chain.lt.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  return chain
}

/** Build a minimal payment row as returned by the Supabase query. */
function makePaymentRow(
  id: string,
  status: string,
  overrides: { provider_reference?: string; metadata?: unknown } = {}
) {
  return {
    id,
    status,
    provider_reference: overrides.provider_reference,
    metadata: overrides.metadata ?? {
      split: {
        feeCaptureMethod: "atomic_split",
        merchantWallet: "9abc...",
        pinetreeWallet: "7def...",
      },
    },
  }
}

/** Build a minimal Transaction for mock return values. */
function makeTx(
  id: string,
  paymentId: string,
  status: TransactionStatus,
  overrides: { provider_transaction_id?: string } = {}
): Transaction {
  return {
    id,
    payment_id: paymentId,
    merchant_id: "merch-001",
    provider: "solana",
    status,
    provider_transaction_id: overrides.provider_transaction_id,
    created_at: new Date().toISOString(),
  }
}

// ── Shared beforeEach: reset all mocks to a clean state ──────────────────────

beforeEach(() => {
  mockFrom.mockReset()
  mockGetTransactionByPaymentId.mockReset()
  mockGetPaymentEvents.mockReset()
  mockCreatePaymentEvent.mockReset()
  mockReconcile.mockReset()
  mockGetEligibility.mockReset()
  mockMarkIncomplete.mockReset()

  // Safe defaults so tests that don't configure these don't crash.
  mockGetTransactionByPaymentId.mockResolvedValue(null)
  mockGetPaymentEvents.mockResolvedValue([])
  mockCreatePaymentEvent.mockResolvedValue({ id: "evt-001" } as never)
})

// ── 1. FAILED + provider_transaction_id → FAILED ─────────────────────────────

describe("Scenario 1 — FAILED payment with provider_transaction_id", () => {
  it("updates the linked transaction to FAILED regardless of provider_transaction_id", async () => {
    const payment = makePaymentRow("pay-001", "FAILED")
    const transaction = makeTx("tx-001", "pay-001", "PROCESSING", {
      provider_transaction_id: "sig_abc",
    })

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment])) // Phase 1: terminal
      .mockReturnValueOnce(makeDbChain([]))         // Phase 2: stale

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockReconcile.mockResolvedValue({
      skipped: false,
      newStatus: "FAILED",
      transactionId: "tx-001",
      previousStatus: "PROCESSING",
    })

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockReconcile).toHaveBeenCalledWith("pay-001", "FAILED")
    // Phase 1 repairs transactions only — it does not create lifecycle payment_events.
    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(result.updatedTransactions).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(false)
  })
})

// ── 2. CONFIRMED does not downgrade ──────────────────────────────────────────

describe("Scenario 2 — CONFIRMED payment does not downgrade", () => {
  it("skips when the linked transaction is already CONFIRMED (already_in_sync)", async () => {
    const payment = makePaymentRow("pay-001", "CONFIRMED")
    const transaction = makeTx("tx-001", "pay-001", "CONFIRMED")

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockReconcile).not.toHaveBeenCalled()
    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.updatedTransactions).toBe(0)
    expect(result.examples[0].skipReason).toBe("already_in_sync")
  })

  it("skips FAILED payment when transaction is CONFIRMED (transaction_already_confirmed — Rule 10)", async () => {
    const payment = makePaymentRow("pay-001", "FAILED")
    const transaction = makeTx("tx-001", "pay-001", "CONFIRMED")

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockReconcile).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.examples[0].skipReason).toBe("transaction_already_confirmed")
  })
})

// ── 3. Stale PENDING with no evidence → INCOMPLETE ───────────────────────────

describe("Scenario 3 — stale PENDING with no evidence → marked INCOMPLETE", () => {
  it("calls markPaymentIncomplete and counts as updatedPayments", async () => {
    mockFrom
      .mockReturnValueOnce(makeDbChain([]))                               // Phase 1
      .mockReturnValueOnce(makeDbChain([{ id: "pay-001", status: "PENDING" }])) // Phase 2

    mockGetEligibility.mockResolvedValue({
      eligible: true,
      status: "PENDING",
      reason: "pending_no_activity_timeout",
    })
    mockMarkIncomplete.mockResolvedValue(true)

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockMarkIncomplete).toHaveBeenCalledWith(
      "pay-001",
      expect.objectContaining({
        providerEvent: "admin.backfill.reconcile-transactions",
        minimumAgeMs: expect.any(Number),
      })
    )
    expect(result.updatedPayments).toBe(1)
    expect(result.updatedTransactions).toBe(0)
    expect(result.scanned).toBe(1)
  })
})

// ── 4. Stale PENDING with provider reference → skipped ───────────────────────

describe("Scenario 4 — stale PENDING with provider reference", () => {
  it("skips the payment when getPaymentIncompleteEligibility detects evidence", async () => {
    mockFrom
      .mockReturnValueOnce(makeDbChain([]))
      .mockReturnValueOnce(makeDbChain([{ id: "pay-001", status: "PENDING" }]))

    mockGetEligibility.mockResolvedValue({
      eligible: false,
      status: "PENDING",
      reason: "payment_has_processing_evidence",
    })

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockMarkIncomplete).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.examples[0].skipReason).toBe("payment_has_processing_evidence")
  })
})

// ── 5. PROCESSING is never targeted ──────────────────────────────────────────

describe("Scenario 5 — PROCESSING payment is never targeted", () => {
  it("scans zero rows when both query phases return empty results", async () => {
    // PROCESSING is excluded from Phase 1 (queries CONFIRMED/FAILED/INCOMPLETE)
    // and from Phase 2 (queries CREATED/PENDING with age filter).
    mockFrom
      .mockReturnValueOnce(makeDbChain([])) // Phase 1 — no PROCESSING rows
      .mockReturnValueOnce(makeDbChain([])) // Phase 2 — no PROCESSING rows

    const result = await runTransactionBackfill({ dryRun: false })

    expect(result.scanned).toBe(0)
    expect(mockReconcile).not.toHaveBeenCalled()
    expect(mockMarkIncomplete).not.toHaveBeenCalled()
  })

  it("Phase 1 .in() filter includes CONFIRMED/FAILED/INCOMPLETE — not PROCESSING", async () => {
    mockFrom
      .mockReturnValueOnce(makeDbChain([]))
      .mockReturnValueOnce(makeDbChain([]))

    await runTransactionBackfill({ dryRun: false })

    const phase1Chain = mockFrom.mock.results[0]?.value as ReturnType<typeof makeDbChain>
    // Verify the in() call was made with only terminal statuses
    expect(phase1Chain.in).toHaveBeenCalledWith(
      "status",
      expect.arrayContaining(["CONFIRMED", "FAILED", "INCOMPLETE"])
    )
    const phase1InArgs = phase1Chain.in.mock.calls[0]?.[1] as string[]
    expect(phase1InArgs).not.toContain("PROCESSING")
  })
})

// ── 6. INCOMPLETE evidence guard ─────────────────────────────────────────────

describe("Scenario 6 — INCOMPLETE payment evidence guard", () => {
  it("6a: syncs transaction to INCOMPLETE when no provider evidence exists", async () => {
    // No provider_reference on payment, no provider_transaction_id on tx
    const payment = makePaymentRow("pay-001", "INCOMPLETE")
    const transaction = makeTx("tx-001", "pay-001", "PENDING") // no provider_transaction_id

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockGetPaymentEvents.mockResolvedValue([])
    mockReconcile.mockResolvedValue({
      skipped: false,
      newStatus: "INCOMPLETE",
      transactionId: "tx-001",
      previousStatus: "PENDING",
    })

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockReconcile).toHaveBeenCalledWith("pay-001", "INCOMPLETE")
    // Phase 1 repairs transactions only — it does not create lifecycle payment_events.
    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(result.updatedTransactions).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it("6b: skips transaction when provider_transaction_id is set (real evidence guard)", async () => {
    // Transaction has an on-chain tx id — real paymentHasProcessingEvidence will return true.
    const payment = makePaymentRow("pay-001", "INCOMPLETE")
    const transaction = makeTx("tx-001", "pay-001", "PENDING", {
      provider_transaction_id: "sig_abc",
    })

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockGetPaymentEvents.mockResolvedValue([])

    const result = await runTransactionBackfill({ dryRun: false })

    // provider_transaction_id is set → pre-check skips (mirrors Rule 3c in reconcileTransactionForPayment)
    expect(mockReconcile).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.examples[0].skipReason).toBe("has_provider_transaction_id")
  })
})

// ── 7. Dry-run makes no writes ────────────────────────────────────────────────

describe("Scenario 7 — dry-run mode", () => {
  it("counts what would change but makes zero DB writes", async () => {
    const payment = makePaymentRow("pay-001", "FAILED")
    const transaction = makeTx("tx-001", "pay-001", "PENDING")

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(
        makeDbChain([{ id: "pay-002", status: "PENDING" }])
      )

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockGetEligibility.mockResolvedValue({
      eligible: true,
      status: "PENDING",
      reason: "pending_no_activity_timeout",
    })

    const result = await runTransactionBackfill({ dryRun: true })

    // No writes
    expect(mockReconcile).not.toHaveBeenCalled()
    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(mockMarkIncomplete).not.toHaveBeenCalled()

    // But counts reflect what would have been done
    expect(result.dryRun).toBe(true)
    expect(result.updatedTransactions).toBe(1) // Phase 1: FAILED → FAILED
    expect(result.updatedPayments).toBe(1)      // Phase 2: stale → INCOMPLETE
    expect(result.scanned).toBe(2)
  })
})

// ── 8. Phase 1 never creates lifecycle payment_events ────────────────────────
// Transaction-row repairs are not payment lifecycle transitions.  The payment
// status was already written (and its payment_event already created) when the
// payment first reached FAILED/CONFIRMED/INCOMPLETE.  Phase 1 only syncs the
// transactions table — it must never add duplicate lifecycle events.

describe("Scenario 8 — Phase 1 does not create lifecycle payment_events", () => {
  it("FAILED payment tx repair: reconcile called, no payment_event created", async () => {
    const payment = makePaymentRow("pay-001", "FAILED")
    const transaction = makeTx("tx-001", "pay-001", "PENDING")

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockReconcile.mockResolvedValue({
      skipped: false,
      newStatus: "FAILED",
      transactionId: "tx-001",
      previousStatus: "PENDING",
    })

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockReconcile).toHaveBeenCalledWith("pay-001", "FAILED")
    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(result.updatedTransactions).toBe(1)
  })

  it("CONFIRMED payment tx repair: reconcile called, no payment_event created", async () => {
    const payment = makePaymentRow("pay-001", "CONFIRMED")
    const transaction = makeTx("tx-001", "pay-001", "PENDING")

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockReconcile.mockResolvedValue({
      skipped: false,
      newStatus: "CONFIRMED",
      transactionId: "tx-001",
      previousStatus: "PENDING",
    })

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockReconcile).toHaveBeenCalledWith("pay-001", "CONFIRMED")
    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(result.updatedTransactions).toBe(1)
  })

  it("race condition — reconcile skipped after pre-check: no payment_event, counted as skipped", async () => {
    const payment = makePaymentRow("pay-001", "FAILED")
    const transaction = makeTx("tx-001", "pay-001", "PENDING")

    mockFrom
      .mockReturnValueOnce(makeDbChain([payment]))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId.mockResolvedValue(transaction)
    mockReconcile.mockResolvedValue({
      skipped: true,
      skipReason: "already_terminal",
      transactionId: "tx-001",
      previousStatus: "FAILED",
      newStatus: null,
    })

    const result = await runTransactionBackfill({ dryRun: false })

    expect(mockCreatePaymentEvent).not.toHaveBeenCalled()
    expect(result.updatedTransactions).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.examples[0].skipReason).toBe("already_terminal")
  })
})

// ── Summary shape ─────────────────────────────────────────────────────────────

describe("Summary shape", () => {
  it("returns all required fields with correct types", async () => {
    mockFrom
      .mockReturnValueOnce(makeDbChain([]))
      .mockReturnValueOnce(makeDbChain([]))

    const result = await runTransactionBackfill({ dryRun: true })

    expect(result).toMatchObject({
      scanned: expect.any(Number),
      skipped: expect.any(Number),
      updatedPayments: expect.any(Number),
      updatedTransactions: expect.any(Number),
      examples: expect.any(Array),
      skipReasons: expect.any(Object),
      dryRun: true,
    })
  })

  it("skipReasons accumulates counts by reason across multiple rows", async () => {
    const payments = [
      makePaymentRow("pay-001", "CONFIRMED"),
      makePaymentRow("pay-002", "CONFIRMED"),
    ]
    const confirmedTx = makeTx("tx-001", "pay-001", "CONFIRMED")

    mockFrom
      .mockReturnValueOnce(makeDbChain(payments))
      .mockReturnValueOnce(makeDbChain([]))

    mockGetTransactionByPaymentId
      .mockResolvedValueOnce(confirmedTx)
      .mockResolvedValueOnce(null)

    const result = await runTransactionBackfill({ dryRun: false })

    expect(result.skipReasons["already_in_sync"]).toBe(1)
    expect(result.skipReasons["no_linked_transaction"]).toBe(1)
    expect(result.skipped).toBe(2)
  })
})
