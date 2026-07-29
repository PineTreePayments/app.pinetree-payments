import {
  getAdminMerchantMetrics,
  getAdminProviderMetrics,
  getAdminGrowthMetrics,
  getAdminRecentTickets,
  getAdminRecentFeedback,
  type AdminOverviewMetrics,
  type AdminGrowthMetrics,
  type AdminRecentTicket,
  type AdminRecentFeedback,
  PAYMENT_METRICS_DEFAULT,
  MERCHANT_METRICS_DEFAULT,
  PROVIDER_METRICS_DEFAULT,
  GROWTH_METRICS_DEFAULT,
} from "@/database/adminOverview"
import {
  getAllCanonicalTransactions,
  getCanonicalTransactionPage,
  type CanonicalTransaction,
} from "./canonicalTransactions"

export type AdminOverviewRecentTransaction = {
  paymentId: string
  merchantId: string
  canonicalStatus: CanonicalTransaction["canonicalStatus"]
  displayStatus: string
  provider: string
  network: string
  rail: CanonicalTransaction["rail"]
  asset: string
  currency: string
  amountMinor: number
  displayAmount: string
  occurredAt: string
}

export type AdminOverviewResult = {
  metrics: AdminOverviewMetrics
  growth: AdminGrowthMetrics
  recentTransactions: AdminOverviewRecentTransaction[]
  recentTickets: AdminRecentTicket[]
  recentFeedback: AdminRecentFeedback[]
  generatedAt: string
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (result.status === "rejected") {
    console.error(`[admin/overview] ${label} rejected`, result.reason)
    return fallback
  }
  return result.value
}

function summarizePayments(rows: readonly CanonicalTransaction[]): typeof PAYMENT_METRICS_DEFAULT {
  const metrics = { ...PAYMENT_METRICS_DEFAULT }
  metrics.totalTransactions = rows.length

  for (const row of rows) {
    switch (row.canonicalStatus) {
      case "CONFIRMED":
        metrics.confirmedTransactions += 1
        metrics.totalConfirmedVolume += row.amountMinor / 100
        metrics.totalFeesCollected += (row.feeAmountMinor ?? 0) / 100
        break
      case "PROCESSING": metrics.processingTransactions += 1; break
      case "CREATED":
      case "PENDING": metrics.pendingTransactions += 1; break
      case "FAILED": metrics.failedTransactions += 1; break
      case "INCOMPLETE": metrics.incompleteTransactions += 1; break
      case "CANCELED": metrics.canceledTransactions += 1; break
      case "EXPIRED": metrics.expiredTransactions += 1; break
    }
  }

  return metrics
}

function canonicalGrowth(
  rows: readonly CanonicalTransaction[],
  merchantGrowth: AdminGrowthMetrics
): AdminGrowthMetrics {
  const now = new Date()
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const monthRows = rows.filter((row) => Date.parse(row.createdAt) >= monthStart)
  return {
    usersThisMonth: merchantGrowth.usersThisMonth,
    transactionsThisMonth: monthRows.length,
    volumeThisMonth: monthRows
      .filter((row) => row.canonicalStatus === "CONFIRMED")
      .reduce((sum, row) => sum + row.amountMinor / 100, 0),
  }
}

export function toAdminOverviewRecentTransaction(
  row: CanonicalTransaction
): AdminOverviewRecentTransaction {
  return {
    paymentId: row.paymentId,
    merchantId: row.merchantId,
    canonicalStatus: row.canonicalStatus,
    displayStatus: row.displayStatus,
    provider: row.provider,
    network: row.network,
    rail: row.rail,
    asset: row.asset,
    currency: row.currency,
    amountMinor: row.amountMinor,
    displayAmount: row.displayAmount,
    occurredAt: row.occurredAt,
  }
}

export async function getAdminOverview(): Promise<AdminOverviewResult> {
  // Exact all-time metrics and current-month growth inherently require the
  // complete canonical payment-root set. Recent activity is a separate,
  // bounded page so the overview never retains or serializes all embedded
  // attempt/event evidence merely to display ten rows.
  const results = await Promise.allSettled([
    getAllCanonicalTransactions({ scope: { type: "admin" } }),
    getCanonicalTransactionPage({
      scope: { type: "admin" },
      page: 1,
      pageSize: 10,
    }).then((result) => result.rows.map(toAdminOverviewRecentTransaction)),
    getAdminMerchantMetrics(),
    getAdminProviderMetrics(),
    getAdminGrowthMetrics(),
    getAdminRecentTickets(5),
    getAdminRecentFeedback(5),
  ])

  const [r0, r1, r2, r3, r4, r5, r6] = results

  const canonicalRows = settled(r0, [] as CanonicalTransaction[], "canonicalTransactions")
  const recentTransactions = settled(r1, [] as AdminOverviewRecentTransaction[], "recentTransactions")
  const paymentMetrics = summarizePayments(canonicalRows)
  const merchantMetrics = settled(r2, MERCHANT_METRICS_DEFAULT, "merchantMetrics")
  const providerMetrics = settled(r3, PROVIDER_METRICS_DEFAULT, "providerMetrics")
  const merchantGrowth = settled(r4, GROWTH_METRICS_DEFAULT, "growthMetrics")
  const growth = canonicalGrowth(canonicalRows, merchantGrowth)
  const recentTickets = settled(r5, [] as AdminRecentTicket[], "recentTickets")
  const recentFeedback = settled(r6, [] as AdminRecentFeedback[], "recentFeedback")

  return {
    metrics: {
      ...paymentMetrics,
      ...merchantMetrics,
      ...providerMetrics,
    },
    growth,
    recentTransactions,
    recentTickets,
    recentFeedback,
    generatedAt: new Date().toISOString(),
  }
}
