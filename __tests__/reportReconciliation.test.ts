import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database/reports", () => ({
  getMerchantReportContext: vi.fn(),
}))

vi.mock("@/engine/canonicalTransactions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/canonicalTransactions")>()
  return { ...actual, getAllCanonicalTransactions: vi.fn() }
})

import { getMerchantReportContext } from "@/database/reports"
import {
  getAllCanonicalTransactions,
  projectCanonicalTransaction,
  type RawCanonicalTransactionPayment,
} from "@/engine/canonicalTransactions"
import { generateReportCsv, generateReportEngine } from "@/engine/reports"

const payments = vi.mocked(getAllCanonicalTransactions)
const context = vi.mocked(getMerchantReportContext)

function canonicalPayment(overrides: Partial<RawCanonicalTransactionPayment> = {}) {
  const id = String(overrides.id || "pay-1")
  return projectCanonicalTransaction({
    id,
    merchant_id: "merchant-1",
    merchant_amount: 9.85,
    pinetree_fee: 0.15,
    gross_amount: 10,
    currency: "USD",
    provider: "stripe",
    provider_reference: `provider-${id}`,
    status: "CONFIRMED",
    network: "stripe",
    metadata: { source: "pos" },
    created_at: "2026-07-17T12:00:00.000Z",
    updated_at: "2026-07-17T12:01:00.000Z",
    transactions: [{
      id: `attempt-${id}`,
      payment_id: id,
      provider: "stripe",
      network: "stripe",
      status: "CONFIRMED",
      channel: "pos",
      total_amount: 1000,
      subtotal_amount: 985,
      platform_fee: 15,
      created_at: "2026-07-17T12:00:30.000Z",
    }],
    payment_events: [],
    ...overrides,
  })
}

describe("report reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    context.mockResolvedValue({
      merchant: { id: "merchant-1", name: "Shop", email: null },
      settings: {
        business_name: "Shop",
        address: null,
        city: null,
        state: null,
        zip: null,
        country: null,
        phone: null,
        timezone: "America/Chicago",
      },
      tax: { tax_enabled: true, tax_rate: 8.25, tax_name: "Sales Tax" },
    })
  })

  it("counts only canonical confirmed sales and reconciles provider, rail, and asset totals", async () => {
    payments.mockResolvedValue([
      canonicalPayment({
        id: "pay-card",
        merchant_amount: 10,
        pinetree_fee: 0.15,
        gross_amount: 10.15,
        provider: "stripe",
        network: "stripe",
      }),
      canonicalPayment({
        id: "pay-crypto",
        merchant_amount: 20,
        pinetree_fee: 0.15,
        gross_amount: 20.15,
        provider: "lightning_speed",
        network: "bitcoin_lightning",
        transactions: [],
      }),
      canonicalPayment({
        id: "pay-incomplete",
        merchant_amount: 50,
        pinetree_fee: 0.15,
        gross_amount: 50.15,
        status: "INCOMPLETE",
      }),
      canonicalPayment({
        id: "pay-failed",
        merchant_amount: 40,
        pinetree_fee: 0.15,
        gross_amount: 40.15,
        provider: "fluidpay",
        network: "fluidpay",
        status: "FAILED",
      }),
    ])

    const report = await generateReportEngine({
      merchantId: "merchant-1",
      startDate: "2026-07-17",
      endDate: "2026-07-17",
      type: "custom",
    })

    expect(report.grossVolume).toBeCloseTo(30.3)
    expect(report.pineTreeFees).toBeCloseTo(0.3)
    expect(report.confirmedCount).toBe(2)
    expect(report.incompleteCount).toBe(1)
    expect(report.failedCount).toBe(1)
    expect(report.cardVolume).toBeCloseTo(10.15)
    expect(report.cryptoVolume).toBeCloseTo(20.15)
    expect(report.assetTotals).toEqual({ BTC: 20.15 })
    expect(Object.values(report.assetTotals).reduce((sum, value) => sum + value, 0)).toBe(report.cryptoVolume)
    expect(report.reconciliation).toEqual({
      providerMatchesGross: true,
      railMatchesGross: true,
      assetMatchesCrypto: true,
      variance: 0,
    })
  })

  it("preserves recorded historical fees and prevents CSV formula injection", async () => {
    payments.mockResolvedValue([canonicalPayment({
      id: "=malicious",
      merchant_amount: 9.9,
      pinetree_fee: 0.1,
      gross_amount: 10,
      provider_reference: "+cmd",
    })])

    const report = await generateReportEngine({
      merchantId: "merchant-1",
      startDate: "2026-07-17",
      endDate: "2026-07-17",
    })
    expect(report.pineTreeFees).toBe(0.1)
    const csv = generateReportCsv(report)
    expect(csv).toContain("'=malicious")
    expect(csv).toContain("'+cmd")
    expect(csv).toContain("0.10")
  })

  it("preserves an explicitly recorded zero historical fee", async () => {
    payments.mockResolvedValue([canonicalPayment({
      id: "pay-waived-fee",
      merchant_amount: 10,
      pinetree_fee: 0,
      gross_amount: 10,
      transactions: [{
        id: "attempt-waived-fee",
        provider: "stripe",
        status: "CONFIRMED",
        platform_fee: 15,
        created_at: "2026-07-17T12:00:30.000Z",
      }],
    })])
    const report = await generateReportEngine({ merchantId: "merchant-1", startDate: "2026-07-17", endDate: "2026-07-17" })
    expect(report.pineTreeFees).toBe(0)
    expect(report.netSettlements).toBe(10)
  })

  it("totals many small values in integer minor units without floating-point drift", async () => {
    payments.mockResolvedValue(Array.from({ length: 100 }, (_, index) => canonicalPayment({
      id: `pay-small-${index}`,
      merchant_amount: 0.01,
      pinetree_fee: index % 2 === 0 ? 0.1 : 0.15,
      gross_amount: 0.01,
      created_at: `2026-07-17T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    })))
    const report = await generateReportEngine({ merchantId: "merchant-1", startDate: "2026-07-17", endDate: "2026-07-17" })
    expect(report.grossVolume).toBe(1)
    expect(report.pineTreeFees).toBe(12.5)
    expect(report.avgTransaction).toBe(0.01)
    expect(report.reconciliation.variance).toBe(0)
  })

  it("returns exact zero totals for an empty period and keeps refunds separate from lifecycle status", async () => {
    payments.mockResolvedValue([])
    const empty = await generateReportEngine({ merchantId: "merchant-1", startDate: "2026-07-17", endDate: "2026-07-17" })
    expect(empty.grossVolume).toBe(0)
    expect(empty.avgTransaction).toBe(0)
    expect(empty.reconciliation).toMatchObject({ providerMatchesGross: true, railMatchesGross: true, assetMatchesCrypto: true, variance: 0 })

    payments.mockResolvedValue([canonicalPayment({
      id: "pay-refund",
      merchant_amount: 4.85,
      pinetree_fee: 0.15,
      gross_amount: 5,
      transactions: [
        { id: "tx-original", provider: "stripe", status: "CONFIRMED", created_at: "2026-07-17T12:00:00.000Z" },
        { id: "tx-refund", provider: "stripe", status: "REFUNDED", created_at: "2026-07-17T13:00:00.000Z" },
      ],
    })])
    const refunded = await generateReportEngine({ merchantId: "merchant-1", startDate: "2026-07-17", endDate: "2026-07-17" })
    expect(refunded.transactionsTable[0]).toMatchObject({
      paymentId: "pay-refund",
      canonicalStatus: "CONFIRMED",
      status: "Confirmed",
      adjustmentStatus: "REFUNDED",
    })
    expect(refunded.grossVolume).toBe(5)
    expect(refunded.confirmedCount).toBe(1)
    expect(refunded.refundedAmount).toBe(5)
    expect(refunded.refundedCount).toBe(1)
  })
})
