/**
 * Tests for engine/reconcileTransaction.ts
 *
 * Run:
 *   npx vitest run __tests__/reconcileTransaction.test.ts
 *
 * Covers the reconciliation cases required by the payment/transaction fix spec:
 *   A.  Payment CONFIRMED  → linked pending transaction → CONFIRMED
 *   B.  Payment FAILED     → linked processing transaction (no provider_tx_id) → FAILED
 *   C.  Payment INCOMPLETE → linked pending transaction (no provider_tx_id) → INCOMPLETE
 *   C2. Payment EXPIRED    → linked pending transaction (no provider_tx_id) → INCOMPLETE
 *   C3. Payment CANCELLED  → linked pending transaction (no provider_tx_id) → INCOMPLETE
 *   D.  Payment INCOMPLETE → linked pending transaction with provider_transaction_id → skipped
 *   E.  Already CONFIRMED transaction is not overwritten by FAILED/INCOMPLETE payment
 *   F.  Transaction with provider_transaction_id is not incorrectly marked INCOMPLETE for FAILED
 *   G.  Already CONFIRMED transaction + CONFIRMED payment → already_confirmed skip
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  reconcileTransactionForPayment,
  paymentToTransactionTerminalStatus,
} from "../engine/reconcileTransaction"

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../database/transactions", () => ({
  getTransactionByPaymentId: vi.fn(),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
}))

import {
  getTransactionByPaymentId,
  updateTransactionStatus,
} from "../database/transactions"
import type { Transaction, TransactionStatus } from "../database/transactions"

const mockGetTransaction = vi.mocked(getTransactionByPaymentId)
const mockUpdateTransaction = vi.mocked(updateTransactionStatus)

function makeTx(overrides: Partial<{
  id: string
  status: TransactionStatus
  provider_transaction_id: string | undefined
}> = {}): Transaction {
  return {
    id: overrides.id ?? "tx-001",
    payment_id: "pay-001",
    merchant_id: "merch-001",
    provider: "test",
    status: overrides.status ?? "PENDING",
    provider_transaction_id: overrides.provider_transaction_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ── paymentToTransactionTerminalStatus ────────────────────────────────────────

describe("paymentToTransactionTerminalStatus", () => {
  it("maps CONFIRMED → CONFIRMED", () => {
    expect(paymentToTransactionTerminalStatus("CONFIRMED")).toBe("CONFIRMED")
  })
  it("maps FAILED → FAILED", () => {
    expect(paymentToTransactionTerminalStatus("FAILED")).toBe("FAILED")
  })
  it("maps INCOMPLETE → INCOMPLETE", () => {
    expect(paymentToTransactionTerminalStatus("INCOMPLETE")).toBe("INCOMPLETE")
  })
  it("maps EXPIRED → INCOMPLETE (EXPIRED is not a first-class transaction state)", () => {
    expect(paymentToTransactionTerminalStatus("EXPIRED")).toBe("INCOMPLETE")
  })
  it("maps CANCELLED → INCOMPLETE (CANCELLED is not a first-class transaction state)", () => {
    expect(paymentToTransactionTerminalStatus("CANCELLED")).toBe("INCOMPLETE")
  })
})

// ── reconcileTransactionForPayment ───────────────────────────────────────────

describe("reconcileTransactionForPayment", () => {
  beforeEach(() => {
    mockGetTransaction.mockReset()
    mockUpdateTransaction.mockReset()
    mockUpdateTransaction.mockResolvedValue(makeTx())
  })

  // ── Case A ────────────────────────────────────────────────────────────────
  it("A: payment CONFIRMED → pending transaction becomes CONFIRMED", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "PENDING" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "CONFIRMED")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("CONFIRMED")
    expect(result.previousStatus).toBe("PENDING")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "CONFIRMED")
  })

  it("A2: payment CONFIRMED → processing transaction becomes CONFIRMED", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "PROCESSING" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "CONFIRMED")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("CONFIRMED")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "CONFIRMED")
  })

  // ── Case B ────────────────────────────────────────────────────────────────
  it("B: payment FAILED → processing transaction (no provider_tx_id) becomes FAILED", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "PROCESSING", provider_transaction_id: undefined }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "FAILED")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("FAILED")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "FAILED")
  })

  // ── Case C: INCOMPLETE → INCOMPLETE ───────────────────────────────────────
  it("C: payment INCOMPLETE → pending transaction (no provider_tx_id) becomes INCOMPLETE", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "PENDING", provider_transaction_id: undefined }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "INCOMPLETE")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("INCOMPLETE")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "INCOMPLETE")
  })

  it("C2: payment EXPIRED → pending transaction (no provider_tx_id) becomes INCOMPLETE", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "PENDING", provider_transaction_id: undefined }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "EXPIRED")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("INCOMPLETE")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "INCOMPLETE")
  })

  it("C3: payment CANCELLED → pending transaction (no provider_tx_id) becomes INCOMPLETE", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "PENDING", provider_transaction_id: undefined }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "CANCELLED")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("INCOMPLETE")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "INCOMPLETE")
  })

  // ── Case D ────────────────────────────────────────────────────────────────
  it("D: payment INCOMPLETE → pending transaction with provider_transaction_id → skipped", async () => {
    mockGetTransaction.mockResolvedValue(
      makeTx({ status: "PENDING", provider_transaction_id: "0xabc123" })    )

    const result = await reconcileTransactionForPayment("pay-001", "INCOMPLETE")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("has_provider_transaction_id")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── Case E ────────────────────────────────────────────────────────────────
  it("E: already CONFIRMED transaction is not overwritten by FAILED payment", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "CONFIRMED" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "FAILED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("transaction_already_confirmed")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  it("E2: already CONFIRMED transaction is not overwritten by INCOMPLETE payment", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "CONFIRMED" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "INCOMPLETE")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("transaction_already_confirmed")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  it("E3: already CONFIRMED transaction is not overwritten by EXPIRED payment", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "CONFIRMED" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "EXPIRED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("transaction_already_confirmed")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  it("E4: already CONFIRMED transaction is not overwritten by CANCELLED payment", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "CONFIRMED" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "CANCELLED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("transaction_already_confirmed")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── Case F ────────────────────────────────────────────────────────────────
  it("F: FAILED payment + transaction with provider_transaction_id → skipped", async () => {
    mockGetTransaction.mockResolvedValue(
      makeTx({ status: "PROCESSING", provider_transaction_id: "sig_abc" })    )

    const result = await reconcileTransactionForPayment("pay-001", "FAILED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("has_provider_transaction_id")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── Case G ────────────────────────────────────────────────────────────────
  it("G: CONFIRMED payment + already CONFIRMED transaction → already_confirmed skip (no write)", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "CONFIRMED" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "CONFIRMED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("already_confirmed")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── Edge: CONFIRMED payment overrides FAILED transaction ─────────────────
  it("CONFIRMED payment overrides a FAILED transaction (payment is source of truth)", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "FAILED" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "CONFIRMED")

    expect(result.skipped).toBe(false)
    expect(result.newStatus).toBe("CONFIRMED")
    expect(mockUpdateTransaction).toHaveBeenCalledWith("tx-001", "CONFIRMED")
  })

  // ── Edge: no linked transaction ───────────────────────────────────────────
  it("no linked transaction → skip with no_linked_transaction reason", async () => {
    mockGetTransaction.mockResolvedValue(null as never)

    const result = await reconcileTransactionForPayment("pay-001", "CONFIRMED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("no_linked_transaction")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── Edge: already INCOMPLETE transaction + INCOMPLETE payment → skipped ───
  it("already INCOMPLETE transaction + INCOMPLETE payment → already_terminal skip", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "INCOMPLETE" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "INCOMPLETE")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("already_terminal")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── Edge: already INCOMPLETE transaction + EXPIRED payment → skipped ──────
  it("already INCOMPLETE transaction + EXPIRED payment → already_terminal skip", async () => {
    mockGetTransaction.mockResolvedValue(makeTx({ status: "INCOMPLETE" }) as never)

    const result = await reconcileTransactionForPayment("pay-001", "EXPIRED")

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("already_terminal")
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })
})
