import { describe, expect, it } from "vitest"

import {
  normalizeCanonicalPaymentStatus,
  projectCanonicalTransaction,
  selectCanonicalTransactionAttempt,
  type RawCanonicalTransactionPayment,
} from "@/engine/canonicalTransactions"
import {
  orderRawCanonicalTransactionPayment,
  sanitizeCanonicalTransactionSearch,
} from "@/database/canonicalTransactions"

function payment(
  overrides: Partial<RawCanonicalTransactionPayment> = {}
): RawCanonicalTransactionPayment {
  return {
    id: "pay_1",
    merchant_id: "merchant_1",
    merchant_amount: 10,
    pinetree_fee: 0.3,
    gross_amount: 10.3,
    currency: "USD",
    provider: "base",
    provider_reference: "provider_payment_1",
    status: "PENDING",
    network: "base",
    metadata: { selectedAsset: "ETH", source: "pos" },
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-07-28T10:05:00.000Z",
    transactions: [{
      id: "attempt_1",
      payment_id: "pay_1",
      provider: "base",
      provider_transaction_id: "0xactual-payment-transaction",
      network: "base",
      status: "PENDING",
      channel: "pos",
      total_amount: 1030,
      subtotal_amount: 1000,
      platform_fee: 30,
      created_at: "2026-07-28T10:01:00.000Z",
    }],
    payment_events: [{
      id: "evt_1",
      payment_id: "pay_1",
      event_type: "payment.pending",
      provider_event: "provider_evt_1",
      created_at: "2026-07-28T10:01:00.000Z",
    }],
    ...overrides,
  }
}

describe("canonical transaction lifecycle projection", () => {
  it.each([
    ["CREATED", "CREATED", "Waiting"],
    ["PENDING", "PENDING", "Waiting"],
    ["PROCESSING", "PROCESSING", "Processing"],
    ["CONFIRMED", "CONFIRMED", "Confirmed"],
    ["FAILED", "FAILED", "Failed"],
    ["EXPIRED", "EXPIRED", "Expired"],
    ["CANCELED", "CANCELED", "Canceled"],
    ["CANCELLED", "CANCELED", "Canceled"],
    ["INCOMPLETE", "INCOMPLETE", "Incomplete"],
  ])("maps payments.status %s to %s", (raw, canonical, display) => {
    expect(normalizeCanonicalPaymentStatus(raw, "pay_1")).toMatchObject({
      canonicalStatus: canonical,
      displayStatus: display,
      diagnostics: [],
    })
  })

  it("returns UNKNOWN with diagnostics instead of adopting a provider status", () => {
    const row = projectCanonicalTransaction(payment({
      status: "provider_succeeded",
      transactions: [{
        id: "attempt_confirmed",
        status: "CONFIRMED",
        provider_transaction_id: "0xprovider-confirmed",
        created_at: "2026-07-28T10:02:00.000Z",
      }],
      payment_events: [{
        id: "evt_confirmed",
        event_type: "payment.confirmed",
        created_at: "2026-07-28T10:03:00.000Z",
      }],
    }))

    expect(row.canonicalStatus).toBe("UNKNOWN")
    expect(row.displayStatus).toBe("Unknown")
    expect(row.diagnostics).toEqual([
      expect.objectContaining({ code: "UNKNOWN_PAYMENT_STATUS", rawValue: "PROVIDER_SUCCEEDED" }),
    ])
  })

  it("never lets late canceled/expired events or transaction status regress payments.status", () => {
    const row = projectCanonicalTransaction(payment({
      status: "CONFIRMED",
      transactions: [{ id: "attempt_1", status: "FAILED", created_at: "2026-07-28T10:01:00.000Z" }],
      payment_events: [
        { id: "evt_confirm", event_type: "payment.confirmed", created_at: "2026-07-28T10:02:00.000Z" },
        { id: "evt_cancel", event_type: "payment.canceled", created_at: "2026-07-28T10:04:00.000Z" },
        { id: "evt_expire", event_type: "payment.expired", created_at: "2026-07-28T10:05:00.000Z" },
      ],
    }))

    expect(row.canonicalStatus).toBe("CONFIRMED")
    expect(row.confirmedAt).toBe("2026-07-28T10:02:00.000Z")
    expect(row.lifecycleEvents.map((event) => event.status)).toEqual([
      "CONFIRMED", "CANCELED", "EXPIRED",
    ])
  })

  it("retains duplicate webhook events only as marked timeline evidence", () => {
    const row = projectCanonicalTransaction(payment({
      status: "PROCESSING",
      payment_events: [
        { id: "evt_2", event_type: "payment.confirmed", provider_event: "webhook_1", created_at: "2026-07-28T10:03:00.000Z" },
        { id: "evt_1", event_type: "payment.processing", provider_event: "webhook_1", created_at: "2026-07-28T10:02:00.000Z" },
      ],
    }))

    expect(row.canonicalStatus).toBe("PROCESSING")
    expect(row.lifecycleEvents.map((event) => event.isDuplicate)).toEqual([false, true])
  })
})

describe("canonical attempt, adjustment, and hash evidence", () => {
  it("chooses the newest non-adjustment attempt deterministically", () => {
    const selected = selectCanonicalTransactionAttempt([
      { id: "attempt_old", created_at: "2026-07-28T10:00:00.000Z", status: "CONFIRMED" },
      { id: "refund_new", created_at: "2026-07-28T10:03:00.000Z", status: "REFUNDED" },
      { id: "attempt_new", created_at: "2026-07-28T10:02:00.000Z", status: "PENDING" },
    ])
    expect(selected?.id).toBe("attempt_new")
  })

  it("keeps REFUNDED/DISPUTED separate from canonical lifecycle", () => {
    const row = projectCanonicalTransaction(payment({
      status: "CONFIRMED",
      transactions: [
        { id: "refund", status: "REFUNDED", updated_at: "2026-07-28T10:10:00.000Z" },
        { id: "attempt", status: "CONFIRMED", created_at: "2026-07-28T10:01:00.000Z" },
      ],
    }))
    expect(row.canonicalStatus).toBe("CONFIRMED")
    expect(row.adjustmentStatus).toBe("REFUNDED")
    expect(row.attemptId).toBe("attempt")
  })

  it("uses the actual Base payment attempt hash, never approval metadata", () => {
    const withPaymentHash = projectCanonicalTransaction(payment({
      metadata: {
        selectedAsset: "USDC",
        approvalTxHash: "0xapproval-only",
        transactionHash: "0xapproval-only",
        txHash: "0xapproval-only",
      },
      transactions: [{
        id: "base_payment_attempt",
        status: "PROCESSING",
        provider_transaction_id: "0xactual-payment",
        network: "base",
        created_at: "2026-07-28T10:02:00.000Z",
      }],
    }))
    const approvalOnly = projectCanonicalTransaction(payment({
      metadata: { selectedAsset: "USDC", approvalTxHash: "0xapproval", txHash: "0xapproval" },
      transactions: [],
    }))

    expect(withPaymentHash.transactionHash).toBe("0xactual-payment")
    expect(withPaymentHash.asset).toBe("USDC")
    expect(approvalOnly.transactionHash).toBeNull()
  })
})

describe("canonical rail, asset, amount, and identity", () => {
  it.each([
    [{ provider: "speed", network: null, metadata: {} }, "Bitcoin Lightning", "BTC", "USD"],
    [{ provider: "lightning_nwc", network: "lightning", metadata: { selectedAsset: "unknown" } }, "Bitcoin Lightning", "BTC", "USD"],
    [{ provider: "cash", network: "cash", currency: "EUR", metadata: {} }, "Cash", "USD", "USD"],
    [{ provider: "stripe", network: "stripe", currency: "EUR", metadata: {} }, "Card", "USD", "USD"],
    [{ provider: "solana", network: "solana", metadata: { selectedAsset: "SOL" } }, "Solana", "SOL", "USD"],
    [{ provider: "solana", network: "solana", metadata: { selectedAsset: "USDC" } }, "Solana", "USDC", "USD"],
    [{ provider: "base", network: "base", metadata: { selectedAsset: "ETH" } }, "Base", "ETH", "USD"],
  ])("normalizes rail fixture %#", (overrides, rail, asset, currency) => {
    const row = projectCanonicalTransaction(payment(overrides))
    expect(row).toMatchObject({ rail, asset, currency })
  })

  it("uses payment identity/time/status and payment gross amount", () => {
    const row = projectCanonicalTransaction(payment())
    expect(row).toMatchObject({
      paymentId: "pay_1",
      attemptId: "attempt_1",
      merchantId: "merchant_1",
      amountMinor: 1030,
      displayAmount: "$10.30",
      occurredAt: "2026-07-28T10:00:00.000Z",
      createdAt: "2026-07-28T10:00:00.000Z",
      providerReference: "provider_payment_1",
    })
  })

  it("orders embedded evidence and sanitizes secondary-reference searches", () => {
    const ordered = orderRawCanonicalTransactionPayment(payment({
      transactions: [
        { id: "a", created_at: "2026-07-28T10:00:00.000Z" },
        { id: "b", created_at: "2026-07-28T10:01:00.000Z" },
      ],
      payment_events: [
        { id: "b", created_at: "2026-07-28T10:01:00.000Z" },
        { id: "a", created_at: "2026-07-28T10:00:00.000Z" },
      ],
    }))
    expect(ordered.transactions?.map((attempt) => attempt.id)).toEqual(["b", "a"])
    expect(ordered.payment_events?.map((event) => event.id)).toEqual(["a", "b"])
    expect(sanitizeCanonicalTransactionSearch(" pay_1%,bad() ")).toBe("pay_1bad")
  })
})
