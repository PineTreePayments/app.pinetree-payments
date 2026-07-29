import { beforeEach, describe, expect, it, vi } from "vitest"

const queryMocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
  or: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
}))

vi.mock("@/database/supabase", () => {
  const query = {
    select: queryMocks.select,
    eq: queryMocks.eq,
    in: queryMocks.in,
    or: queryMocks.or,
    gte: queryMocks.gte,
    lte: queryMocks.lte,
    order: queryMocks.order,
    range: queryMocks.range,
  }
  queryMocks.from.mockReturnValue(query)
  queryMocks.select.mockReturnValue(query)
  queryMocks.eq.mockReturnValue(query)
  queryMocks.in.mockReturnValue(query)
  queryMocks.or.mockReturnValue(query)
  queryMocks.gte.mockReturnValue(query)
  queryMocks.lte.mockReturnValue(query)
  queryMocks.order.mockReturnValue(query)
  queryMocks.range.mockResolvedValue({ data: [], error: null, count: 0, status: 200 })
  return {
    supabaseAdmin: { from: queryMocks.from },
    supabase: null,
  }
})

import {
  loadCanonicalTransactionPage,
  orderRawCanonicalTransactionPayment,
} from "@/database/canonicalTransactions"

const scope = { type: "merchant" as const, merchantId: "merchant-1" }

describe("canonical transaction payment-root query", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("applies exact payment-root predicates and merchant-scopes the embedded attempts", async () => {
    await loadCanonicalTransactionPage({
      scope,
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-31T23:59:59.999Z",
      currency: "usd",
      status: "CANCELED",
      mode: "test",
    })

    expect(queryMocks.from).toHaveBeenCalledTimes(1)
    expect(queryMocks.from).toHaveBeenCalledWith("payments")
    expect(queryMocks.eq).toHaveBeenCalledWith("merchant_id", "merchant-1")
    expect(queryMocks.eq).toHaveBeenCalledWith("transactions.merchant_id", "merchant-1")
    expect(queryMocks.gte).toHaveBeenCalledWith("created_at", "2026-07-01T00:00:00.000Z")
    expect(queryMocks.lte).toHaveBeenCalledWith("created_at", "2026-07-31T23:59:59.999Z")
    expect(queryMocks.eq).toHaveBeenCalledWith("currency", "USD")
    expect(queryMocks.in).toHaveBeenCalledWith("status", ["CANCELED", "CANCELLED"])
    expect(queryMocks.eq).toHaveBeenCalledWith("metadata->>payment_mode", "test")
  })

  it("does not scan transaction history or build payment-id URL filters for projection fields", async () => {
    await loadCanonicalTransactionPage({
      scope,
      provider: "stripe",
      network: "base",
      rail: "card",
      method: "card",
      asset: "USD",
      source: "shopify",
      channel: "pos",
      search: "provider-reference",
      mode: "pos",
    })

    expect(queryMocks.from).toHaveBeenCalledTimes(1)
    expect(queryMocks.from).toHaveBeenCalledWith("payments")
    expect(queryMocks.or).not.toHaveBeenCalled()
    expect(queryMocks.eq).not.toHaveBeenCalledWith("provider", expect.anything())
    expect(queryMocks.eq).not.toHaveBeenCalledWith("network", expect.anything())
    expect(queryMocks.select.mock.calls[0]?.[0]).not.toContain("transactions!inner")
    expect(queryMocks.select.mock.calls[0]?.[0]).not.toContain("id.in.")
  })

  it("drops explicitly cross-payment and cross-merchant embedded evidence", () => {
    const ordered = orderRawCanonicalTransactionPayment({
      id: "payment-1",
      merchant_id: "merchant-1",
      created_at: "2026-07-28T00:00:00.000Z",
      transactions: [
        {
          id: "same-payment-same-merchant",
          payment_id: "payment-1",
          merchant_id: "merchant-1",
          created_at: "2026-07-28T01:00:00.000Z",
        },
        {
          id: "other-merchant",
          payment_id: "payment-1",
          merchant_id: "merchant-2",
          created_at: "2026-07-28T03:00:00.000Z",
        },
        {
          id: "other-payment",
          payment_id: "payment-2",
          merchant_id: "merchant-1",
          created_at: "2026-07-28T02:00:00.000Z",
        },
        {
          id: "legacy-unscoped",
          created_at: "2026-07-28T00:30:00.000Z",
        },
      ],
      payment_events: [
        { id: "right-event", payment_id: "payment-1" },
        { id: "wrong-event", payment_id: "payment-2" },
      ],
    })

    expect(ordered.transactions?.map((attempt) => attempt.id)).toEqual([
      "same-payment-same-merchant",
      "legacy-unscoped",
    ])
    expect(ordered.payment_events?.map((event) => event.id)).toEqual(["right-event"])
  })

  // PostgREST rejects the whole query when an embedded select names a column
  // the table does not have, so a single wrong name takes down every canonical
  // surface at once. The deployed transactions table settles on completed_at.
  it("selects only columns the deployed payments and transactions tables have", async () => {
    await loadCanonicalTransactionPage({ scope })

    const selectClause = String(queryMocks.select.mock.calls[0]?.[0] || "")
    const [, embeddedTransactions = ""] = /transactions \(([^)]*)\)/.exec(selectClause) || []
    const embeddedColumns = embeddedTransactions
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean)

    expect(embeddedColumns).toContain("completed_at")
    expect(embeddedColumns).not.toContain("updated_at")

    const deployedTransactionColumns = new Set([
      "application_fee", "channel", "completed_at", "created_at", "currency",
      "id", "merchant_id", "network", "payment_id", "platform_fee", "provider",
      "provider_transaction_id", "raw_response", "status", "subtotal_amount",
      "total_amount",
    ])
    for (const column of embeddedColumns) {
      expect(deployedTransactionColumns).toContain(column)
    }
  })

  it("returns an empty page when PostgREST reports an unsatisfiable range", async () => {
    queryMocks.range.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: 2,
      status: 416,
    })

    await expect(loadCanonicalTransactionPage({ scope, page: 9, pageSize: 25 }))
      .resolves.toEqual({
        rows: [],
        totalCount: 2,
        page: 9,
        pageSize: 25,
        totalPages: 1,
      })
  })
})
