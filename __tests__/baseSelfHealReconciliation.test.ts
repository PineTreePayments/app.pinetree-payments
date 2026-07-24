import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Self-healing reconciliation coverage.
 *
 * Repairs the exact live incident: a POS terminal marked a Base ETH payment
 * INCOMPLETE (merchant cancel, "terminal_cancel") after treating a
 * WalletConnect request as expired, moments before/after the customer's
 * wallet actually submitted the transaction on-chain. The engine's ordinary
 * state machine correctly treats INCOMPLETE as terminal for every normal
 * caller — this suite proves the ONE narrow exception (verified on-chain
 * evidence, routed through `reconcile: true`) repairs the record instead of
 * leaving it permanently wrong, without opening the door for any other
 * caller to resurrect a cancelled/failed payment.
 */

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  getPaymentByProviderReference: vi.fn(),
  updatePaymentStatus: vi.fn(),
  createPaymentEvent: vi.fn().mockResolvedValue(undefined),
  upsertLedgerEntry: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEvents: vi.fn().mockResolvedValue([]),
  getPaymentEventByProviderEvent: vi.fn().mockResolvedValue(null)
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  getTransactionByProviderReference: vi.fn().mockResolvedValue(null),
  updateTransactionProviderReference: vi.fn().mockResolvedValue(undefined),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: vi.fn().mockResolvedValue({ skipped: true })
}))

vi.mock("@/engine/webhookDelivery", () => ({
  deliverWebhook: vi.fn().mockResolvedValue(undefined),
  deliverV1CheckoutSessionWebhook: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/providers/registry", () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
  setProviderHealth: vi.fn()
}))

vi.mock("@/engine/paymentWatcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/paymentWatcher")>()
  return { ...actual, watchPaymentOnce: vi.fn() }
})

import {
  createPaymentEvent,
  getPaymentById,
  updatePaymentStatus as updatePaymentStatusInDb
} from "@/database"
import { getTransactionByPaymentId } from "@/database/transactions"
import { processPaymentEvent } from "@/engine/eventProcessor"
import { watchPaymentOnce } from "@/engine/paymentWatcher"
import { reconcileBasePaymentFromChain } from "@/engine/baseChainReconciliation"

const mockGetPayment = vi.mocked(getPaymentById)
const mockDbUpdate = vi.mocked(updatePaymentStatusInDb)
const mockCreateEvent = vi.mocked(createPaymentEvent)
const mockGetTransaction = vi.mocked(getTransactionByPaymentId)
const mockWatchPaymentOnce = vi.mocked(watchPaymentOnce)

const basePayment = {
  id: "pay-incident",
  merchant_id: "merchant-1",
  merchant_amount: 0.27,
  pinetree_fee: 0.15,
  gross_amount: 0.42,
  currency: "USD",
  provider: "base",
  status: "INCOMPLETE" as const,
  network: "base",
  metadata: {
    split: {
      feeCaptureMethod: "contract_split",
      merchantWallet: "0xmerchant",
      pinetreeWallet: "0xtreasury",
      splitContract: "0xsplit",
      expectedAmountNative: 0.000223586216442104,
      merchantNativeAmountAtomic: "143733996284210",
      feeNativeAmountAtomic: "79852220157894",
      asset: "ETH"
    }
  },
  created_at: "2026-07-23T18:16:28.604Z",
  updated_at: "2026-07-23T18:17:16.069Z"
}

describe("processPaymentEvent — INCOMPLETE self-heal bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTransaction.mockResolvedValue(null)
  })

  it("repairs INCOMPLETE -> CONFIRMED when reconcile:true and verified evidence is provided, recording a payment.reconciled audit event", async () => {
    // Simulate a real row: every getPaymentById read reflects whatever the
    // last compare-and-set write committed, regardless of exact call count
    // through repairIncompletePaymentForReconciliation / advancePaymentToTargetStatus
    // / the ledger-entry read inside processPaymentEvent.
    let simulatedStatus = "INCOMPLETE"
    mockGetPayment.mockImplementation(async () => ({ ...basePayment, status: simulatedStatus } as never))
    mockDbUpdate.mockImplementation(async (_id: string, next: string) => {
      simulatedStatus = next
      return { ...basePayment, status: next } as never
    })

    await processPaymentEvent({
      type: "payment.confirmed",
      paymentId: "pay-incident",
      txHash: "0xabc123",
      value: "223586216442104",
      from: "0xcustomer",
      feeCaptureValidated: true,
      reconcile: true
    })

    // The bypass wrote INCOMPLETE -> PROCESSING directly (not through
    // assertValidTransition, which forbids it for every other caller).
    expect(mockDbUpdate).toHaveBeenCalledWith("pay-incident", "PROCESSING", "INCOMPLETE")
    // ...then the ordinary, already-guarded PROCESSING -> CONFIRMED path ran.
    expect(mockDbUpdate).toHaveBeenCalledWith("pay-incident", "CONFIRMED", "PROCESSING")

    const eventTypes = mockCreateEvent.mock.calls.map((c) => (c[0] as { event_type: string }).event_type)
    expect(eventTypes).toContain("payment.reconciled")
    expect(eventTypes).toContain("payment.confirmed")
  })

  it("does not repair INCOMPLETE without the reconcile flag (ordinary watcher/webhook calls stay idempotent no-ops)", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "INCOMPLETE" })

    await processPaymentEvent({
      type: "payment.confirmed",
      paymentId: "pay-incident",
      txHash: "0xabc123",
      feeCaptureValidated: true
      // reconcile omitted
    })

    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockCreateEvent).not.toHaveBeenCalled()
  })

  it("never repairs a payment that is already CONFIRMED, even with reconcile:true (CONFIRMED remains terminal)", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "CONFIRMED" })

    await processPaymentEvent({
      type: "payment.confirmed",
      paymentId: "pay-incident",
      txHash: "0xabc123",
      feeCaptureValidated: true,
      reconcile: true
    })

    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("never repairs INCOMPLETE toward FAILED via the reconcile bypass", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "INCOMPLETE" })

    await processPaymentEvent({
      type: "payment.failed",
      paymentId: "pay-incident",
      txHash: "0xabc123",
      reconcile: true
    })

    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("treats a concurrent repair race as a no-op instead of throwing (compare-and-set loses cleanly)", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "INCOMPLETE" } as never)
    mockDbUpdate.mockRejectedValue(
      new Error("Concurrent payment transition skipped: payment status changed")
    )

    await expect(
      processPaymentEvent({
        type: "payment.confirmed",
        paymentId: "pay-incident",
        txHash: "0xabc123",
        feeCaptureValidated: true,
        reconcile: true
      })
    ).resolves.toBeUndefined()

    expect(mockCreateEvent).not.toHaveBeenCalled()
  })
})

describe("reconcileBasePaymentFromChain — canonical repair entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTransaction.mockResolvedValue(null)
  })

  it("is a no-op for a payment that is already CONFIRMED (idempotent — safe to re-run)", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "CONFIRMED" })

    const result = await reconcileBasePaymentFromChain("pay-incident")

    expect(result).toMatchObject({ attempted: false, detected: false, reason: "already_confirmed" })
    expect(mockWatchPaymentOnce).not.toHaveBeenCalled()
  })

  it("is a no-op for a non-Base payment", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "INCOMPLETE", network: "solana" })

    const result = await reconcileBasePaymentFromChain("pay-incident")

    expect(result.reason).toBe("not_base_network")
    expect(mockWatchPaymentOnce).not.toHaveBeenCalled()
  })

  it("runs the canonical watcher with reconcile:true and reports detected:true on a chain match", async () => {
    mockGetPayment
      .mockResolvedValueOnce({ ...basePayment, status: "INCOMPLETE" })
      .mockResolvedValueOnce({ ...basePayment, status: "CONFIRMED" })
    mockWatchPaymentOnce.mockImplementation(async () => true)

    const result = await reconcileBasePaymentFromChain("pay-incident")

    expect(mockWatchPaymentOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "pay-incident",
        network: "base",
        reconcile: true,
        merchantWallet: "0xmerchant",
        pinetreeWallet: "0xtreasury"
      })
    )
    expect(result.detected).toBe(true)
    expect(result.status).toBe("CONFIRMED")
  })

  it("reports detected:false when no chain evidence is found in the lookback window", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "INCOMPLETE" })
    mockWatchPaymentOnce.mockImplementation(async () => false)

    const result = await reconcileBasePaymentFromChain("pay-incident")

    expect(result.detected).toBe(false)
    expect(result.reason).toBe("no_chain_evidence_in_window")
  })

  it("never throws when the chain check itself errors — repair simply did not happen this run", async () => {
    mockGetPayment.mockResolvedValue({ ...basePayment, status: "INCOMPLETE" })
    mockWatchPaymentOnce.mockRejectedValue(new Error("RPC timeout"))

    await expect(reconcileBasePaymentFromChain("pay-incident")).resolves.toMatchObject({
      detected: false
    })
  })
})
