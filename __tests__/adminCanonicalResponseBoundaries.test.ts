import { beforeEach, describe, expect, it, vi } from "vitest"

const canonicalMocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getPage: vi.fn(),
  getById: vi.fn(),
}))

const overviewMocks = vi.hoisted(() => ({
  getMerchantMetrics: vi.fn(async () => ({ activeMerchants: 2, totalMerchants: 3 })),
  getProviderMetrics: vi.fn(async () => ({ connectedProviders: 4 })),
  getGrowthMetrics: vi.fn(async () => ({
    usersThisMonth: 1,
    transactionsThisMonth: 0,
    volumeThisMonth: 0,
  })),
  getRecentTickets: vi.fn(async () => []),
  getRecentFeedback: vi.fn(async () => []),
}))

vi.mock("@/engine/canonicalTransactions", () => ({
  getAllCanonicalTransactions: canonicalMocks.getAll,
  getCanonicalTransactionPage: canonicalMocks.getPage,
  getCanonicalTransactionById: canonicalMocks.getById,
}))

vi.mock("@/database/adminTransactions", () => ({
  getAdminTransactionEvents: vi.fn(async () => []),
  getAdminTransactionMerchant: vi.fn(async () => null),
}))

vi.mock("@/database/adminOverview", () => ({
  getAdminMerchantMetrics: overviewMocks.getMerchantMetrics,
  getAdminProviderMetrics: overviewMocks.getProviderMetrics,
  getAdminGrowthMetrics: overviewMocks.getGrowthMetrics,
  getAdminRecentTickets: overviewMocks.getRecentTickets,
  getAdminRecentFeedback: overviewMocks.getRecentFeedback,
  PAYMENT_METRICS_DEFAULT: {
    totalTransactions: 0,
    confirmedTransactions: 0,
    processingTransactions: 0,
    pendingTransactions: 0,
    failedTransactions: 0,
    incompleteTransactions: 0,
    canceledTransactions: 0,
    expiredTransactions: 0,
    totalConfirmedVolume: 0,
    totalFeesCollected: 0,
  },
  MERCHANT_METRICS_DEFAULT: { activeMerchants: 0, totalMerchants: 0 },
  PROVIDER_METRICS_DEFAULT: { connectedProviders: 0 },
  GROWTH_METRICS_DEFAULT: {
    usersThisMonth: 0,
    transactionsThisMonth: 0,
    volumeThisMonth: 0,
  },
}))

import { getAdminOverview } from "@/engine/adminOverview"
import {
  getAdminTransactionsEngine,
  resolveAdminTransactionPagination,
} from "@/engine/adminTransactions"

const now = new Date().toISOString()

const recentCanonical = {
  paymentId: "payment-recent",
  attemptId: "attempt-private",
  merchantId: "merchant-1",
  providerReference: "provider-reference-private-detail",
  transactionHash: "0xprivate-detail",
  rail: "Base",
  network: "Base",
  asset: "USDC",
  currency: "USD",
  amountMinor: 1_250,
  displayAmount: "$12.50",
  canonicalStatus: "CANCELED",
  displayStatus: "Canceled",
  occurredAt: now,
  createdAt: now,
  confirmedAt: null,
  source: "payments",
  provider: "base",
  channel: "online",
  paymentMode: "live",
  adjustmentStatus: null,
  adjustedAt: null,
  merchantAmountMinor: 1_200,
  grossAmountMinor: 1_250,
  feeAmountMinor: 50,
  subtotalAmountMinor: 1_200,
  transactionAmountMinor: 1_250,
  metadata: { internalSecret: "do-not-return" },
  lifecycleEvents: [{ id: "event-private" }],
  attempts: [{ id: "attempt-private" }],
  diagnostics: [{ code: "internal-diagnostic" }],
  raw: { paymentStatus: "CANCELED" },
}

describe("admin canonical response boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canonicalMocks.getAll.mockResolvedValue([recentCanonical])
    canonicalMocks.getPage.mockResolvedValue({
      rows: [recentCanonical],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    })
  })

  it("loads recent overview rows through a bounded canonical page and returns a narrow DTO", async () => {
    const result = await getAdminOverview()

    expect(canonicalMocks.getPage).toHaveBeenCalledWith({
      scope: { type: "admin" },
      page: 1,
      pageSize: 10,
    })
    expect(result.recentTransactions).toEqual([{
      paymentId: "payment-recent",
      merchantId: "merchant-1",
      canonicalStatus: "CANCELED",
      displayStatus: "Canceled",
      provider: "base",
      network: "Base",
      rail: "Base",
      asset: "USDC",
      currency: "USD",
      amountMinor: 1_250,
      displayAmount: "$12.50",
      occurredAt: now,
    }])
    expect(JSON.stringify(result.recentTransactions)).not.toContain("do-not-return")
    expect(JSON.stringify(result.recentTransactions)).not.toContain("attempt-private")
    expect(JSON.stringify(result.recentTransactions)).not.toContain("internal-diagnostic")
  })

  it("rejects a non-page-aligned offset instead of returning the wrong slice", async () => {
    expect(resolveAdminTransactionPagination(50, 100)).toEqual({ page: 3, pageSize: 50 })

    let error: unknown
    try {
      await getAdminTransactionsEngine({}, 50, 25)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ status: 400 })
    expect(String((error as Error).message)).toContain("offset must be a multiple of limit")
    expect(canonicalMocks.getPage).not.toHaveBeenCalled()
    expect(canonicalMocks.getAll).not.toHaveBeenCalled()
  })
})
