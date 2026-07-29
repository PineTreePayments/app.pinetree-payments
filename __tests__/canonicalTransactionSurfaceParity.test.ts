import { beforeEach, describe, expect, it, vi } from "vitest"

const canonicalMocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getPage: vi.fn(),
  getById: vi.fn(),
}))

vi.mock("@/engine/canonicalTransactions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/canonicalTransactions")>()
  return {
    ...actual,
    getAllCanonicalTransactions: canonicalMocks.getAll,
    getCanonicalTransactionPage: canonicalMocks.getPage,
    getCanonicalTransactionById: canonicalMocks.getById,
  }
})

vi.mock("@/database", () => {
  const settingsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  }
  settingsQuery.select.mockReturnValue(settingsQuery)
  settingsQuery.eq.mockReturnValue(settingsQuery)
  settingsQuery.maybeSingle.mockResolvedValue({
    data: { timezone: "America/Chicago" },
    error: null,
  })
  return {
    supabaseAdmin: { from: vi.fn(() => settingsQuery) },
    supabase: null,
  }
})

vi.mock("@/database/reports", () => ({
  getMerchantReportContext: vi.fn(async () => ({
    merchant: { id: "merchant-1", name: "Parity Shop", email: "owner@example.com" },
    settings: {
      business_name: "Parity Shop",
      address: null,
      city: null,
      state: null,
      zip: null,
      country: null,
      phone: null,
      timezone: "America/Chicago",
    },
    tax: { tax_enabled: false, tax_rate: 0, tax_name: "Sales Tax" },
  })),
}))

vi.mock("@/database/adminTransactions", () => ({
  getAdminTransactionEvents: vi.fn(async () => []),
  getAdminTransactionMerchant: vi.fn(async () => null),
}))

vi.mock("@/engine/walletOverview", () => ({
  getWalletOverviewEngine: vi.fn(async () => ({ totalUsd: 0, lastRun: null })),
}))

vi.mock("@/engine/inventory", () => ({
  getInventoryEngine: vi.fn(async () => ({
    available: false,
    summary: { totalItems: 0, lowStock: 0, outOfStock: 0 },
    integrations: [],
  })),
}))

vi.mock("@/engine/providersDashboard", () => ({
  getProvidersDashboardEngine: vi.fn(async () => ({})),
  buildOverviewRailReadiness: vi.fn(() => []),
}))

vi.mock("@/engine/businessProfile", () => ({
  getMerchantBusinessProfile: vi.fn(async () => ({
    profile_status: "complete",
    missing_fields: [],
  })),
}))

import {
  projectCanonicalTransaction,
  type CanonicalTransaction,
  type CanonicalTransactionPageInput,
  type CanonicalTransactionReadFilters,
  type RawCanonicalTransactionPayment,
} from "@/engine/canonicalTransactions"
import { getDashboardOverviewEngine } from "@/engine/dashboardOverview"
import {
  getTransactionsDashboardEngine,
  resolveTransactionsTimeFilter,
} from "@/engine/transactionsDashboard"
import { generateReportCsv, generateReportEngine } from "@/engine/reports"
import { resolveMerchantReportRange } from "@/engine/reportPeriods"
import { getAdminTransactionsEngine } from "@/engine/adminTransactions"
import { getPlatformReportEngine } from "@/engine/adminReports"

type FixtureInput = {
  id: string
  status: string
  provider: string
  network: string
  asset?: string
  amountMinor: number
  occurredAt: string
  merchantId?: string
  transactionHash?: string | null
  metadata?: Record<string, unknown>
  paymentEvents?: RawCanonicalTransactionPayment["payment_events"]
}

function fixture(input: FixtureInput): CanonicalTransaction {
  const transactionHash = input.transactionHash === undefined
    ? `hash-${input.id}`
    : input.transactionHash
  const hasAttempt = transactionHash !== null && input.provider !== "speed" && input.provider !== "cash"
  return projectCanonicalTransaction({
    id: input.id,
    merchant_id: input.merchantId || "merchant-1",
    merchant_amount: (input.amountMinor - 15) / 100,
    pinetree_fee: 0.15,
    gross_amount: input.amountMinor / 100,
    currency: "USD",
    provider: input.provider,
    provider_reference: `provider-${input.id}`,
    status: input.status,
    network: input.network,
    metadata: {
      selectedAsset: input.asset,
      source: "pos",
      ...input.metadata,
    },
    created_at: input.occurredAt,
    updated_at: new Date(Date.parse(input.occurredAt) + 60_000).toISOString(),
    transactions: hasAttempt ? [{
      id: `attempt-${input.id}`,
      payment_id: input.id,
      provider: input.provider,
      provider_transaction_id: transactionHash,
      network: input.network,
      status: input.status,
      channel: "pos",
      total_amount: input.amountMinor,
      subtotal_amount: input.amountMinor - 15,
      platform_fee: 15,
      created_at: new Date(Date.parse(input.occurredAt) + 30_000).toISOString(),
    }] : [],
    payment_events: input.paymentEvents || [],
  })
}

const merchantRows = [
  fixture({
    id: "pay-confirmed-base-eth",
    status: "CONFIRMED",
    provider: "base",
    network: "base",
    asset: "ETH",
    amountMinor: 1010,
    occurredAt: "2026-07-17T05:30:00.000Z",
    paymentEvents: [
      { id: "evt-confirm", event_type: "payment.confirmed", provider_event: "webhook-confirm-1", created_at: "2026-07-17T05:32:00.000Z" },
      { id: "evt-late-old", event_type: "payment.canceled", provider_event: "webhook-old-cancel", created_at: "2026-07-17T05:31:00.000Z" },
      { id: "evt-confirm-duplicate", event_type: "payment.confirmed", provider_event: "webhook-confirm-1", created_at: "2026-07-17T05:33:00.000Z" },
    ],
  }),
  fixture({
    id: "pay-canceled-base-usdc",
    status: "CANCELED",
    provider: "base",
    network: "base",
    asset: "USDC",
    amountMinor: 2020,
    occurredAt: "2026-07-17T06:30:00.000Z",
    transactionHash: "0xactual-base-usdc-payment",
    metadata: {
      approvalTxHash: "0xapproval-only",
      transactionHash: "0xapproval-only",
      txHash: "0xapproval-only",
    },
  }),
  fixture({
    id: "pay-incomplete-sol",
    status: "INCOMPLETE",
    provider: "solana",
    network: "solana",
    asset: "SOL",
    amountMinor: 3030,
    occurredAt: "2026-07-17T07:30:00.000Z",
  }),
  fixture({
    id: "pay-failed-sol-usdc",
    status: "FAILED",
    provider: "solana",
    network: "solana",
    asset: "USDC",
    amountMinor: 4040,
    occurredAt: "2026-07-17T08:30:00.000Z",
  }),
  fixture({
    id: "pay-expired-lightning",
    status: "EXPIRED",
    provider: "speed",
    network: "bitcoin_lightning",
    amountMinor: 5050,
    occurredAt: "2026-07-17T09:30:00.000Z",
    transactionHash: null,
  }),
  fixture({
    id: "pay-pending-cash",
    status: "PENDING",
    provider: "cash",
    network: "cash",
    amountMinor: 6060,
    occurredAt: "2026-07-17T10:30:00.000Z",
    transactionHash: null,
  }),
  fixture({
    id: "pay-processing-base-eth",
    status: "PROCESSING",
    provider: "base",
    network: "base",
    asset: "ETH",
    amountMinor: 7070,
    occurredAt: "2026-07-17T11:30:00.000Z",
  }),
]

const otherMerchantRow = fixture({
  id: "pay-other-merchant",
  status: "CONFIRMED",
  provider: "stripe",
  network: "stripe",
  amountMinor: 8080,
  occurredAt: "2026-07-17T12:30:00.000Z",
  merchantId: "merchant-2",
})

const allRows = [...merchantRows, otherMerchantRow]

function statusFilter(rows: CanonicalTransaction[], value: CanonicalTransactionReadFilters["status"]) {
  const filters = (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((status) => String(status).toUpperCase() === "WAITING" ? ["CREATED", "PENDING"] : [String(status).toUpperCase()])
  return filters.length ? rows.filter((row) => filters.includes(row.canonicalStatus)) : rows
}

function rowsFor(filters: CanonicalTransactionReadFilters): CanonicalTransaction[] {
  let rows = [...allRows]
  if (filters.scope.type === "merchant") {
    rows = rows.filter((row) => row.merchantId === filters.scope.merchantId)
  } else if (filters.scope.merchantId) {
    rows = rows.filter((row) => row.merchantId === filters.scope.merchantId)
  }
  rows = statusFilter(rows, filters.status)
  if (filters.startDate) rows = rows.filter((row) => Date.parse(row.occurredAt) >= Date.parse(filters.startDate!))
  if (filters.endDate) rows = rows.filter((row) => Date.parse(row.occurredAt) <= Date.parse(filters.endDate!))
  return rows
}

function configureCanonicalReads() {
  canonicalMocks.getAll.mockImplementation(async (filters: CanonicalTransactionReadFilters) => rowsFor(filters))
  canonicalMocks.getPage.mockImplementation(async (input: CanonicalTransactionPageInput) => {
    const rows = rowsFor(input)
    const page = input.page || 1
    const pageSize = input.pageSize || 50
    const start = (page - 1) * pageSize
    return {
      rows: rows.slice(start, start + pageSize),
      totalCount: rows.length,
      page,
      pageSize,
      totalPages: rows.length ? Math.ceil(rows.length / pageSize) : 0,
    }
  })
  canonicalMocks.getById.mockImplementation(async (paymentId: string, filters: CanonicalTransactionReadFilters) =>
    rowsFor(filters).find((row) => row.paymentId === paymentId) || null
  )
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]
    if (char === '"' && quoted && csv[index + 1] === '"') {
      field += '"'
      index++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      row.push(field)
      field = ""
    } else if (char === "\n" && !quoted) {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (char !== "\r") {
      field += char
    }
  }
  row.push(field)
  rows.push(row)
  return rows
}

function parityFields(row: CanonicalTransaction) {
  return {
    paymentId: row.paymentId,
    canonicalStatus: row.canonicalStatus,
    displayStatus: row.displayStatus,
    amountMinor: row.amountMinor,
    rail: row.rail,
    asset: row.asset,
    occurredAt: row.occurredAt,
  }
}

describe("canonical transaction parity across every read surface", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureCanonicalReads()
  })

  it("covers all lifecycle outcomes, event disorder/duplication, and rail/asset normalization", () => {
    expect(merchantRows.map((row) => [row.paymentId, row.canonicalStatus, row.displayStatus])).toEqual([
      ["pay-confirmed-base-eth", "CONFIRMED", "Confirmed"],
      ["pay-canceled-base-usdc", "CANCELED", "Canceled"],
      ["pay-incomplete-sol", "INCOMPLETE", "Incomplete"],
      ["pay-failed-sol-usdc", "FAILED", "Failed"],
      ["pay-expired-lightning", "EXPIRED", "Expired"],
      ["pay-pending-cash", "PENDING", "Waiting"],
      ["pay-processing-base-eth", "PROCESSING", "Processing"],
    ])

    const confirmed = merchantRows[0]
    expect(confirmed.canonicalStatus).toBe("CONFIRMED")
    expect(confirmed.lifecycleEvents.map((event) => event.status)).toEqual(["CANCELED", "CONFIRMED", "CONFIRMED"])
    expect(confirmed.lifecycleEvents.map((event) => event.isDuplicate)).toEqual([false, false, true])

    expect(merchantRows[0]).toMatchObject({ rail: "Base", asset: "ETH" })
    expect(merchantRows[1]).toMatchObject({
      rail: "Base",
      asset: "USDC",
      transactionHash: "0xactual-base-usdc-payment",
    })
    expect(merchantRows[1].transactionHash).not.toBe("0xapproval-only")
    expect(merchantRows[2]).toMatchObject({ rail: "Solana", asset: "SOL" })
    expect(merchantRows[3]).toMatchObject({ rail: "Solana", asset: "USDC" })
    expect(merchantRows[4]).toMatchObject({ rail: "Bitcoin Lightning", asset: "BTC" })
    expect(merchantRows[5]).toMatchObject({ rail: "Cash", asset: "USD", currency: "USD" })
  })

  it("returns identical canonical fields from Overview, Transactions, Reports, and Admin Explorer", async () => {
    const [overview, transactions, report, admin] = await Promise.all([
      getDashboardOverviewEngine("merchant-1"),
      getTransactionsDashboardEngine("merchant-1", { page: 1, pageSize: 100 }),
      generateReportEngine({
        merchantId: "merchant-1",
        type: "custom",
        startDate: "2026-07-17",
        endDate: "2026-07-17",
      }),
      getAdminTransactionsEngine({ merchantId: "merchant-1" }, 100, 0),
    ])

    expect(overview.recentTx).toHaveLength(merchantRows.length)
    expect(transactions.transactions).toHaveLength(merchantRows.length)
    expect(report.transactionsTable).toHaveLength(merchantRows.length)
    expect(admin.rows).toHaveLength(merchantRows.length)

    for (const expected of merchantRows) {
      const fields = parityFields(expected)
      expect(overview.recentTx.find((row) => row.paymentId === expected.paymentId)).toMatchObject(fields)
      expect(transactions.transactions.find((row) => row.paymentId === expected.paymentId)).toMatchObject(fields)
      expect(admin.rows.find((row) => row.paymentId === expected.paymentId)).toMatchObject(fields)
      expect(report.transactionsTable.find((row) => row.paymentId === expected.paymentId)).toMatchObject({
        paymentId: fields.paymentId,
        canonicalStatus: fields.canonicalStatus,
        status: fields.displayStatus,
        amountMinor: fields.amountMinor,
        rail: fields.rail,
        asset: fields.asset,
        occurredAt: fields.occurredAt,
      })
    }
  })

  it("uses merchant-local report boundaries while admin scope sees only what authorization permits", async () => {
    const report = await generateReportEngine({
      merchantId: "merchant-1",
      type: "custom",
      startDate: "2026-07-17",
      endDate: "2026-07-17",
    })
    expect(report).toMatchObject({
      timeZone: "America/Chicago",
      startDate: "2026-07-17T05:00:00.000Z",
      endDate: "2026-07-18T04:59:59.999Z",
    })
    expect(canonicalMocks.getAll).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: "merchant", merchantId: "merchant-1" },
      startDate: "2026-07-17T05:00:00.000Z",
      endDate: "2026-07-18T04:59:59.999Z",
    }))

    const merchantAdmin = await getAdminTransactionsEngine({ merchantId: "merchant-1" }, 100, 0)
    const platformAdmin = await getAdminTransactionsEngine({}, 100, 0)
    expect(merchantAdmin.rows.map((row) => row.paymentId)).not.toContain("pay-other-merchant")
    expect(platformAdmin.rows.map((row) => row.paymentId)).toContain("pay-other-merchant")

    const platformReport = await getPlatformReportEngine("year", "all")
    expect(platformReport).toMatchObject({
      totalTransactions: 8,
      confirmedTransactions: 2,
      confirmedVolume: 90.9,
      processingTransactions: 1,
      incompleteTransactions: 1,
      canceledTransactions: 1,
      failedTransactions: 1,
      expiredTransactions: 1,
      awaitingTransactions: 1,
    })
  })

  it("resolves this-month transaction filters in the merchant timezone, not browser or server time", () => {
    // 2026-07-01T03:30Z is still 2026-06-30 22:30 in Chicago, so "this month"
    // must be June (UTC or server-local time would already say July).
    const now = new Date("2026-07-01T03:30:00.000Z")
    const resolved = resolveTransactionsTimeFilter("this_month", "America/Chicago", now)
    expect(resolved.startDate).toBe("2026-06-01T05:00:00.000Z")
    expect(resolved.endDate).toBe(now.toISOString())

    // The filter must be byte-identical to the Reports "month" period so the
    // Transactions page and Reports reconcile by construction.
    const reportRange = resolveMerchantReportRange({
      type: "month",
      timeZone: "America/Chicago",
      now,
    })
    expect(resolved).toEqual({
      startDate: reportRange.startDate,
      endDate: reportRange.endDate,
    })
  })

  it("exports exactly the visible report rows and canonical fields to CSV", async () => {
    const report = await generateReportEngine({
      merchantId: "merchant-1",
      type: "custom",
      startDate: "2026-07-17",
      endDate: "2026-07-17",
    })
    const [headers, ...records] = parseCsv(generateReportCsv(report))
    const column = Object.fromEntries(headers.map((header, index) => [header, index]))

    expect(records).toHaveLength(report.transactionsTable.length)
    expect(records.map((record) => record[column.payment_id])).toEqual(
      report.transactionsTable.map((row) => row.paymentId)
    )
    for (const visible of report.transactionsTable) {
      const record = records.find((candidate) => candidate[column.payment_id] === visible.paymentId)
      expect(record).toBeDefined()
      expect(record?.[column.canonical_status]).toBe(visible.canonicalStatus)
      expect(record?.[column.display_status]).toBe(visible.status)
      expect(record?.[column.rail]).toBe(visible.rail)
      expect(record?.[column.asset]).toBe(visible.asset)
      expect(record?.[column.gross_total]).toBe(visible.gross.toFixed(2))
    }
  })
})
