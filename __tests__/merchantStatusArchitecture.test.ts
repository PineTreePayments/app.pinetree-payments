import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database/reports", () => ({
  getMerchantReportContext: vi.fn(),
}))

vi.mock("@/engine/canonicalTransactions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/canonicalTransactions")>()
  return { ...actual, getAllCanonicalTransactions: vi.fn() }
})

vi.mock("@/providers/registry", () => ({
  registerProvider: vi.fn(),
  setProviderHealth: vi.fn(),
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
  getMerchantSpeedProvider: vi.fn(),
}))

import { getMerchantReportContext } from "@/database/reports"
import {
  getAllCanonicalTransactions,
  projectCanonicalTransaction,
  type RawCanonicalTransactionPayment,
} from "@/engine/canonicalTransactions"
import { generateReportCsv, generateReportEngine } from "@/engine/reports"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import { basePayAdapter } from "@/providers/basePay"
import { coinbaseAdapter } from "@/providers/coinbase"
import { normalizeSpeedStatus } from "@/providers/lightning/speedAdapter"
import { solanaAdapter } from "@/providers/solana"

const mockPayments = vi.mocked(getAllCanonicalTransactions)
const mockContext = vi.mocked(getMerchantReportContext)

function payment(overrides: Partial<RawCanonicalTransactionPayment>) {
  const id = String(overrides.id)
  return projectCanonicalTransaction({
    id,
    merchant_id: "merchant-1",
    merchant_amount: 10,
    pinetree_fee: 1,
    gross_amount: 11,
    currency: "USD",
    provider: "shift4",
    provider_reference: `provider-${id}`,
    status: "CONFIRMED",
    network: "shift4",
    metadata: { source: "online" },
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:01:00.000Z",
    transactions: [],
    payment_events: [],
    ...overrides,
  })
}

describe("Merchant Status Architecture contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockContext.mockResolvedValue({
      merchant: { id: "merchant-1", name: "Pine Shop", email: "owner@example.com" },
      settings: {
        business_name: "Pine Shop",
        address: null,
        city: null,
        state: null,
        zip: null,
        country: null,
        phone: null,
        timezone: "UTC",
      },
      tax: { tax_enabled: false, tax_rate: 0, tax_name: "Sales Tax" },
    })
  })

  it("does not let unknown provider values masquerade as Waiting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ data: { timeline: [{ status: "MYSTERY" }] } }),
    }))

    await expect(coinbaseAdapter.getPaymentStatus!("charge-1")).resolves.toEqual({ status: null })
    expect(coinbaseAdapter.translateEvent!({ event: { type: "charge:mystery", data: {} } })).toBeNull()
    await expect(basePayAdapter.getPaymentStatus!("pay-1")).resolves.toEqual({ status: null })
    await expect(solanaAdapter.getPaymentStatus!("pay-1")).resolves.toEqual({ status: null })
    expect(normalizeSpeedStatus("MYSTERY")).toBeNull()
  })

  it("keeps Coinbase canceled and expired outcomes distinct from incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { timeline: [{ status: "CANCELED" }] } }) })
      .mockResolvedValueOnce({ json: async () => ({ data: { timeline: [{ status: "EXPIRED" }] } }) }))

    await expect(coinbaseAdapter.getPaymentStatus!("charge-canceled")).resolves.toEqual({ status: "CANCELED" })
    await expect(coinbaseAdapter.getPaymentStatus!("charge-expired")).resolves.toEqual({ status: "EXPIRED" })
  })

  it("defines every current merchant status and the future adjustment presentation", () => {
    expect(getPaymentDisplayStatus("PENDING")).toMatchObject({ label: "Waiting", tone: "waiting", icon: "clock" })
    expect(getPaymentDisplayStatus("PROCESSING")).toMatchObject({ label: "Processing", tone: "processing", icon: "spinner", spin: true })
    expect(getPaymentDisplayStatus("CONFIRMED")).toMatchObject({ label: "Confirmed", tone: "confirmed", icon: "check-circle" })
    expect(getPaymentDisplayStatus("FAILED")).toMatchObject({ label: "Failed", tone: "failed", icon: "x-circle" })
    expect(getPaymentDisplayStatus("EXPIRED")).toMatchObject({ label: "Expired", tone: "expired", icon: "clock" })
    expect(getPaymentDisplayStatus("CANCELED")).toMatchObject({ label: "Canceled", tone: "canceled", icon: "x-circle" })
    expect(getPaymentDisplayStatus("INCOMPLETE")).toMatchObject({ label: "Incomplete", tone: "incomplete", icon: "alert-triangle" })
    expect(getPaymentDisplayStatus("REFUNDED")).toMatchObject({ label: "Refunded", tone: "refunded", icon: "refund" })
    expect(getPaymentDisplayStatus("DISPUTED")).toMatchObject({ label: "Disputed", tone: "disputed", icon: "alert-triangle" })
    expect(() => getPaymentDisplayStatus("provider_mystery")).toThrow("Invalid payment display status")
  })

  it("reports refunds as accounting adjustments without rewriting payment lifecycle", async () => {
    mockPayments.mockResolvedValue([
      payment({
        id: "pay-refunded",
        transactions: [
          { id: "tx-sale", status: "CONFIRMED", provider: "shift4", created_at: "2026-07-01T12:01:00.000Z" },
          { id: "tx-refunded", status: "REFUNDED", provider: "shift4", created_at: "2026-07-01T12:02:00.000Z" },
        ],
      }),
      payment({
        id: "pay-waiting",
        merchant_amount: 5,
        pinetree_fee: 0.5,
        gross_amount: 5.5,
        provider: "stripe",
        network: "stripe",
        status: "PENDING",
        created_at: "2026-07-01T13:00:00.000Z",
      }),
      payment({
        id: "pay-incomplete",
        merchant_amount: 8,
        pinetree_fee: 0.8,
        gross_amount: 8.8,
        provider: "coinbase",
        network: "coinbase",
        status: "INCOMPLETE",
        created_at: "2026-07-01T14:00:00.000Z",
      }),
    ])

    const report = await generateReportEngine({
      merchantId: "merchant-1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-02T00:00:00.000Z",
    })

    expect(report.confirmedCount).toBe(1)
    expect(report.grossVolume).toBe(11)
    expect(report.refundedCount).toBe(1)
    expect(report.refundedAmount).toBe(11)
    expect(report.waitingCount).toBe(1)
    expect(report.incompleteCount).toBe(1)
    expect(report.canceledCount).toBe(0)
    expect(report.statusCounts).toEqual({ Confirmed: 1, Waiting: 1, Incomplete: 1 })
    expect(report.transactionsTable).toEqual([
      expect.objectContaining({ paymentId: "pay-refunded", status: "Confirmed", adjustmentStatus: "REFUNDED" }),
      expect.objectContaining({ paymentId: "pay-waiting", status: "Waiting", adjustmentStatus: null }),
      expect.objectContaining({ paymentId: "pay-incomplete", status: "Incomplete", adjustmentStatus: null }),
    ])
    const csv = generateReportCsv(report)
    expect(csv).toContain("payment_id")
    expect(csv).toContain("pay-refunded")
    expect(csv).toContain("CONFIRMED,Confirmed,REFUNDED")

    const refundedReport = await generateReportEngine({
      merchantId: "merchant-1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-02T00:00:00.000Z",
      status: "REFUNDED",
    })
    expect(refundedReport.transactionsTable).toEqual([
      expect.objectContaining({ paymentId: "pay-refunded", canonicalStatus: "CONFIRMED", adjustmentStatus: "REFUNDED" }),
    ])
    expect(refundedReport.refundedCount).toBe(1)
    expect(refundedReport.confirmedCount).toBe(1)
  })
})
