import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/database/reports", () => ({
  getMerchantPaymentsForReport: vi.fn(),
  getMerchantReportContext: vi.fn(),
}))

vi.mock("@/providers/registry", () => ({
  registerProvider: vi.fn(),
  setProviderHealth: vi.fn(),
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
  getMerchantSpeedProvider: vi.fn(),
}))

import {
  getMerchantPaymentsForReport,
  getMerchantReportContext,
} from "@/database/reports"
import { generateReportCsv, generateReportEngine } from "@/engine/reports"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import { basePayAdapter } from "@/providers/basePay"
import { coinbaseAdapter } from "@/providers/coinbase"
import { normalizeSpeedStatus } from "@/providers/lightning/speedAdapter"
import { solanaAdapter } from "@/providers/solana"

const mockPayments = vi.mocked(getMerchantPaymentsForReport)
const mockContext = vi.mocked(getMerchantReportContext)

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

    await expect(coinbaseAdapter.getPaymentStatus!("charge-1")).resolves.toEqual({ status: "UNKNOWN" })
    expect(coinbaseAdapter.translateEvent!({ event: { type: "charge:mystery", data: {} } })).toBeNull()
    await expect(basePayAdapter.getPaymentStatus!("pay-1")).resolves.toEqual({ status: "UNKNOWN" })
    await expect(solanaAdapter.getPaymentStatus!("pay-1")).resolves.toEqual({ status: "UNKNOWN" })
    expect(normalizeSpeedStatus("MYSTERY")).toBe("UNKNOWN")
  })

  it("defines every current merchant status and the future dispute presentation", () => {
    expect(getPaymentDisplayStatus("PENDING")).toMatchObject({ label: "Waiting", tone: "waiting", icon: "clock" })
    expect(getPaymentDisplayStatus("PROCESSING")).toMatchObject({ label: "Processing", tone: "processing", icon: "spinner", spin: true })
    expect(getPaymentDisplayStatus("CONFIRMED")).toMatchObject({ label: "Confirmed", tone: "confirmed", icon: "check-circle" })
    expect(getPaymentDisplayStatus("FAILED")).toMatchObject({ label: "Failed", tone: "failed", icon: "x-circle" })
    expect(getPaymentDisplayStatus("EXPIRED")).toMatchObject({ label: "Expired", tone: "expired", icon: "alert-triangle" })
    expect(getPaymentDisplayStatus("INCOMPLETE")).toMatchObject({ label: "Incomplete", tone: "incomplete", icon: "alert-triangle" })
    expect(getPaymentDisplayStatus("REFUNDED")).toMatchObject({ label: "Refunded", tone: "refunded", icon: "refund" })
    expect(getPaymentDisplayStatus("DISPUTED")).toMatchObject({ label: "Disputed", tone: "disputed", icon: "alert-triangle" })
    expect(getPaymentDisplayStatus("provider_mystery")).toMatchObject({ label: "Unknown", tone: "unknown", icon: "minus" })
  })

  it("reports refunds as adjustments instead of confirmed payments", async () => {
    mockPayments.mockResolvedValue([
      {
        id: "pay-refunded",
        merchant_amount: 10,
        pinetree_fee: 1,
        gross_amount: 11,
        currency: "USD",
        provider: "shift4",
        status: "CONFIRMED",
        created_at: "2026-07-01T12:00:00.000Z",
        transactions: [{ id: "tx-refunded", status: "REFUNDED", provider: "shift4" }],
      },
      {
        id: "pay-waiting",
        merchant_amount: 5,
        pinetree_fee: 0.5,
        gross_amount: 5.5,
        currency: "USD",
        provider: "stripe",
        status: "PENDING",
        created_at: "2026-07-01T13:00:00.000Z",
        transactions: [{ id: "tx-waiting", status: "PENDING", provider: "stripe" }],
      },
      {
        id: "pay-canceled",
        merchant_amount: 8,
        pinetree_fee: 0.8,
        gross_amount: 8.8,
        currency: "USD",
        provider: "coinbase",
        status: "INCOMPLETE",
        created_at: "2026-07-01T14:00:00.000Z",
        transactions: [{ id: "tx-canceled", status: "INCOMPLETE", provider: "coinbase" }],
      },
    ])

    const report = await generateReportEngine({
      merchantId: "merchant-1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-02T00:00:00.000Z",
    })

    expect(report.confirmedCount).toBe(0)
    expect(report.refundedCount).toBe(1)
    expect(report.refundedAmount).toBe(11)
    expect(report.waitingCount).toBe(1)
    expect(report.incompleteCount).toBe(1)
    expect(report.canceledCount).toBe(0)
    expect(report.statusCounts).toEqual({ Refunded: 1, Waiting: 1, Incomplete: 1 })
    expect(report.transactionsTable.map((row) => row.status)).toEqual(["Refunded", "Waiting", "Incomplete"])
    expect(generateReportCsv(report)).toContain("pay-refunded,pay-refunded,Shift4")
    expect(generateReportCsv(report)).toContain(",Refunded")

    const refundedReport = await generateReportEngine({
      merchantId: "merchant-1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-02T00:00:00.000Z",
      status: "REFUNDED",
    })
    expect(refundedReport.transactionsTable.map((row) => row.paymentId)).toEqual(["pay-refunded"])
    expect(refundedReport.refundedCount).toBe(1)
    expect(refundedReport.confirmedCount).toBe(0)
  })
})
