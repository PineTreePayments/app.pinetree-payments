import {
  getAdminTransactions,
  getAdminTransactionSummary,
  getAdminTransactionDistribution,
  ADMIN_TX_SUMMARY_DEFAULT,
  type AdminTransactionFilters,
  type AdminTransactionRow,
  type AdminTransactionSummary,
} from "@/database/adminTransactions"

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AdminTransactionsResult = {
  rows: AdminTransactionRow[]
  totalCount: number
  summary: AdminTransactionSummary
  distribution: {
    providers: Record<string, number>
    networks: Record<string, number>
  }
  generatedAt: string
}

// ─── Engine ────────────────────────────────────────────────────────────────────

function settled<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (result.status === "rejected") {
    console.error(`[admin/tx] ${label} rejected`, result.reason)
    return fallback
  }
  return result.value
}

/**
 * Platform-wide transaction explorer.
 * Summary reflects the current filter context (not global totals).
 * Rows and totalCount are paginated by limit/offset.
 */
export async function getAdminTransactionsEngine(
  filters: AdminTransactionFilters,
  limit: number,
  offset: number
): Promise<AdminTransactionsResult> {
  const [rowsResult, summaryResult, distributionResult] = await Promise.allSettled([
    getAdminTransactions(filters, limit, offset),
    getAdminTransactionSummary(filters),
    getAdminTransactionDistribution(filters),
  ])

  const { rows, totalCount } = settled(
    rowsResult,
    { rows: [] as AdminTransactionRow[], totalCount: 0 },
    "rows"
  )
  const summary = settled(summaryResult, ADMIN_TX_SUMMARY_DEFAULT, "summary")
  const distribution = settled(
    distributionResult,
    { providers: {} as Record<string, number>, networks: {} as Record<string, number> },
    "distribution"
  )

  return { rows, totalCount, summary, distribution, generatedAt: new Date().toISOString() }
}
