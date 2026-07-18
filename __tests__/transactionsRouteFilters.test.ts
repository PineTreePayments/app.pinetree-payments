import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantId: vi.fn(),
  listTransactions: vi.fn(),
  scheduleMaintenance: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: mocks.requireMerchantId,
  getRouteErrorStatus: () => 500,
}))

vi.mock("@/lib/api/paymentMaintenance", () => ({
  schedulePaymentMaintenance: mocks.scheduleMaintenance,
}))

vi.mock("@/engine/transactionsDashboard", () => ({
  getTransactionsDashboardEngine: mocks.listTransactions,
  getTransactionsChartEngine: vi.fn(),
}))

import { GET } from "@/app/api/transactions/route"

describe("transactions route filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMerchantId.mockResolvedValue("merchant-1")
    mocks.listTransactions.mockResolvedValue({
      transactions: [],
      todayVolume: 0,
      todayTransactions: 0,
      confirmedRate: 0,
      pagination: { page: 2, pageSize: 25, total: 0, totalPages: 1 },
    })
  })

  it("passes combined bounded filters with the authenticated merchant scope", async () => {
    const request = new NextRequest(
      "https://app.test/api/transactions?provider=stripe&network=base&channel=pos&status=CONFIRMED&rail=card&asset=USD&currency=USD&source=shopify&method=card&startDate=2026-07-01&endDate=2026-07-31&page=2&pageSize=25",
      { headers: { Authorization: "Bearer token" } }
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.listTransactions).toHaveBeenCalledWith("merchant-1", {
      provider: "stripe",
      network: "base",
      channel: "pos",
      status: "CONFIRMED",
      rail: "card",
      asset: "USD",
      currency: "USD",
      source: "shopify",
      method: "card",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-31T23:59:59.999Z",
      page: 2,
      pageSize: 25,
    })
  })

  it("drops all sentinel values and applies bounded defaults", async () => {
    await GET(new NextRequest("https://app.test/api/transactions?provider=all"))
    expect(mocks.listTransactions).toHaveBeenCalledWith("merchant-1", expect.objectContaining({
      provider: undefined,
      page: 1,
      pageSize: 50,
    }))
  })
})
