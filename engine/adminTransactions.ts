import {
  getAdminTransactionEvents,
  getAdminTransactionMerchant,
  type AdminTransactionFilters,
  type AdminTransactionSummary,
  type AdminTxEventRow,
  type AdminTxMerchant,
} from "@/database/adminTransactions"
import {
  getAllCanonicalTransactions,
  getCanonicalTransactionById,
  getCanonicalTransactionPage,
  type CanonicalTransaction,
  type CanonicalTransactionReadFilters,
} from "./canonicalTransactions"

export type AdminTransactionDetailResult = {
  payment: CanonicalTransaction
  events: AdminTxEventRow[]
  merchant: AdminTxMerchant | null
}

export type AdminTransactionsResult = {
  rows: CanonicalTransaction[]
  totalCount: number
  summary: AdminTransactionSummary & { canceledCount: number }
  distribution: {
    providers: Record<string, number>
    networks: Record<string, number>
  }
  generatedAt: string
}

function canonicalFilters(filters: AdminTransactionFilters): CanonicalTransactionReadFilters {
  return {
    scope: { type: "admin", merchantId: filters.merchantId || null },
    startDate: filters.from,
    endDate: filters.to,
    provider: filters.provider,
    network: filters.network,
    search: filters.search,
    status: filters.status,
  }
}

function summarize(rows: readonly CanonicalTransaction[]) {
  let confirmedCount = 0
  let processingCount = 0
  let pendingCount = 0
  let failedCount = 0
  let incompleteCount = 0
  let expiredCount = 0
  let canceledCount = 0
  let confirmedVolumeMinor = 0
  let totalFeesMinor = 0

  for (const row of rows) {
    switch (row.canonicalStatus) {
      case "CONFIRMED":
        confirmedCount += 1
        confirmedVolumeMinor += row.amountMinor
        totalFeesMinor += row.feeAmountMinor ?? 0
        break
      case "PROCESSING": processingCount += 1; break
      case "CREATED":
      case "PENDING": pendingCount += 1; break
      case "FAILED": failedCount += 1; break
      case "INCOMPLETE": incompleteCount += 1; break
      case "EXPIRED": expiredCount += 1; break
      case "CANCELED": canceledCount += 1; break
    }
  }

  return {
    totalCount: rows.length,
    confirmedCount,
    processingCount,
    pendingCount,
    failedCount,
    incompleteCount,
    expiredCount,
    canceledCount,
    confirmedVolume: confirmedVolumeMinor / 100,
    totalFees: totalFeesMinor / 100,
  }
}

function distribution(rows: readonly CanonicalTransaction[]) {
  const providers: Record<string, number> = {}
  const networks: Record<string, number> = {}
  for (const row of rows) {
    const provider = row.provider || "unknown"
    const network = row.network || "Unknown"
    providers[provider] = (providers[provider] || 0) + 1
    networks[network] = (networks[network] || 0) + 1
  }
  return { providers, networks }
}

export function resolveAdminTransactionPagination(limit: number, offset: number) {
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 50)))
  const normalizedOffset = Math.max(0, Math.trunc(Number(offset) || 0))

  // The canonical data boundary is page-based. Silently flooring an arbitrary
  // offset returns a different slice than the caller requested, so reject
  // unsupported offsets instead of serving incorrect rows.
  if (normalizedOffset % pageSize !== 0) {
    throw Object.assign(
      new Error(`offset must be a multiple of limit (${pageSize})`),
      { status: 400 }
    )
  }

  return {
    pageSize,
    page: normalizedOffset / pageSize + 1,
  }
}

/** Platform explorer and its aggregates share the identical payment-root filter. */
export async function getAdminTransactionsEngine(
  filters: AdminTransactionFilters,
  limit: number,
  offset: number
): Promise<AdminTransactionsResult> {
  const { page, pageSize } = resolveAdminTransactionPagination(limit, offset)
  const readFilters = canonicalFilters(filters)
  const [pageResult, allRows] = await Promise.all([
    getCanonicalTransactionPage({ ...readFilters, page, pageSize }),
    getAllCanonicalTransactions(readFilters),
  ])

  return {
    rows: pageResult.rows,
    totalCount: pageResult.totalCount,
    summary: summarize(allRows),
    distribution: distribution(allRows),
    generatedAt: new Date().toISOString(),
  }
}

/** Full canonical audit detail for one payment; events remain audit evidence only. */
export async function getAdminTransactionDetailEngine(
  paymentId: string
): Promise<AdminTransactionDetailResult | null> {
  const payment = await getCanonicalTransactionById(paymentId, {
    scope: { type: "admin" },
  })
  if (!payment) return null
  const [events, merchant] = await Promise.all([
    getAdminTransactionEvents(payment.paymentId),
    getAdminTransactionMerchant(payment.merchantId),
  ])
  return { payment, events, merchant }
}
