import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RawCanonicalTransactionPayment } from "@/database/canonicalTransactions"

const dataMocks = vi.hoisted(() => ({
  loadPage: vi.fn(),
  loadAll: vi.fn(),
  loadById: vi.fn(),
}))

vi.mock("@/database/canonicalTransactions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/database/canonicalTransactions")>()
  return {
    ...actual,
    loadCanonicalTransactionPage: dataMocks.loadPage,
    loadAllCanonicalTransactions: dataMocks.loadAll,
    loadCanonicalTransactionById: dataMocks.loadById,
  }
})

import {
  getAllCanonicalTransactions,
  getCanonicalTransactionPage,
} from "@/engine/canonicalTransactions"

const scope = { type: "merchant" as const, merchantId: "merchant-1" }

function payment(
  id: string,
  overrides: Partial<RawCanonicalTransactionPayment> = {}
): RawCanonicalTransactionPayment {
  return {
    id,
    merchant_id: "merchant-1",
    merchant_amount: "10.00",
    gross_amount: "10.00",
    currency: "USD",
    status: "CONFIRMED",
    created_at: "2026-07-28T12:00:00.000Z",
    metadata: {},
    transactions: [],
    payment_events: [],
    ...overrides,
  }
}

const rows: RawCanonicalTransactionPayment[] = [
  payment("payment-base", {
    created_at: "2026-07-28T13:00:00.000Z",
    metadata: { selectedAsset: "ETH", source: "shopify", channel: "online" },
    transactions: [{
      id: "attempt-base",
      payment_id: "payment-base",
      merchant_id: "merchant-1",
      provider: "base",
      provider_transaction_id: "0xbase-payment",
      network: "base",
      channel: "pos",
      status: "CONFIRMED",
      created_at: "2026-07-28T13:01:00.000Z",
    }],
  }),
  payment("payment-lightning", {
    provider: "speed",
    network: "btc_lightning",
    created_at: "2026-07-28T12:00:00.000Z",
    metadata: {},
    transactions: [{
      id: "attempt-lightning",
      payment_id: "payment-lightning",
      merchant_id: "merchant-1",
      provider_transaction_id: "speed-reference",
      channel: "online",
      status: "CONFIRMED",
    }],
  }),
  payment("payment-stripe", {
    provider: "stripe",
    network: "stripe",
    created_at: "2026-07-28T11:00:00.000Z",
    metadata: { integration: "squarespace" },
    transactions: [{
      id: "attempt-stripe",
      payment_id: "payment-stripe",
      merchant_id: "merchant-1",
      channel: "online",
      status: "CONFIRMED",
    }],
  }),
]

describe("canonical projected transaction filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dataMocks.loadAll.mockResolvedValue(rows)
    dataMocks.loadPage.mockResolvedValue({
      rows: [rows[0]],
      totalCount: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    })
  })

  it("combines provider/network/rail/asset/source/channel/method/mode/search on the canonical row", async () => {
    const result = await getCanonicalTransactionPage({
      scope,
      provider: "BASE",
      network: "base",
      rail: "Base",
      method: "base",
      asset: "eth",
      source: "SHOPIFY",
      channel: "pos",
      mode: "pos",
      search: "BASE-PAYMENT",
      page: 1,
      pageSize: 25,
    })

    expect(result.rows.map((row) => row.paymentId)).toEqual(["payment-base"])
    expect(result.totalCount).toBe(1)
    expect(dataMocks.loadAll).toHaveBeenCalledTimes(1)
    expect(dataMocks.loadPage).not.toHaveBeenCalled()
    expect(dataMocks.loadAll).toHaveBeenCalledWith({
      scope,
      startDate: undefined,
      endDate: undefined,
      currency: undefined,
      status: undefined,
      mode: "all",
    })
  })

  it("matches canonical Lightning network aliases and projected source fallbacks", async () => {
    const lightning = await getAllCanonicalTransactions({
      scope,
      network: "bitcoin_lightning",
      asset: "BTC",
      rail: "btc_lightning",
      source: "online",
    })
    const squarespace = await getAllCanonicalTransactions({ scope, source: "squarespace" })

    expect(lightning.map((row) => row.paymentId)).toEqual(["payment-lightning"])
    expect(squarespace.map((row) => row.paymentId)).toEqual(["payment-stripe"])
  })

  it("keeps database pagination when no projection-only filter is active", async () => {
    const result = await getCanonicalTransactionPage({
      scope,
      startDate: "2026-07-01T00:00:00.000Z",
      currency: "USD",
      status: "CONFIRMED",
      mode: "live",
      page: 2,
      pageSize: 25,
    })

    expect(result.rows.map((row) => row.paymentId)).toEqual(["payment-base"])
    expect(dataMocks.loadPage).toHaveBeenCalledTimes(1)
    expect(dataMocks.loadAll).not.toHaveBeenCalled()
    expect(dataMocks.loadPage).toHaveBeenCalledWith({
      scope,
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: undefined,
      currency: "USD",
      status: "CONFIRMED",
      mode: "live",
      page: 2,
      pageSize: 25,
    })
  })

  it("sorts before paging and returns empty rows for an out-of-range projected page", async () => {
    const first = await getCanonicalTransactionPage({
      scope,
      channel: "online",
      page: 1,
      pageSize: 1,
    })
    const outside = await getCanonicalTransactionPage({
      scope,
      provider: "base",
      page: 4,
      pageSize: 2,
    })

    expect(first.rows.map((row) => row.paymentId)).toEqual(["payment-lightning"])
    expect(first.totalCount).toBe(2)
    expect(outside).toMatchObject({
      rows: [],
      totalCount: 1,
      page: 4,
      pageSize: 2,
      totalPages: 1,
    })
  })
})
