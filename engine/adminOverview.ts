import {
  getAdminPaymentMetrics,
  getAdminMerchantMetrics,
  getAdminProviderMetrics,
  getAdminGrowthMetrics,
  getAdminRecentTransactions,
  getAdminRecentTickets,
  getAdminRecentFeedback,
  type AdminOverviewMetrics,
  type AdminGrowthMetrics,
  type AdminRecentTransaction,
  type AdminRecentTicket,
  type AdminRecentFeedback,
  PAYMENT_METRICS_DEFAULT,
  MERCHANT_METRICS_DEFAULT,
  PROVIDER_METRICS_DEFAULT,
  GROWTH_METRICS_DEFAULT,
} from "@/database/adminOverview"

export type AdminOverviewResult = {
  metrics: AdminOverviewMetrics
  growth: AdminGrowthMetrics
  recentTransactions: AdminRecentTransaction[]
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

export async function getAdminOverview(): Promise<AdminOverviewResult> {
  const results = await Promise.allSettled([
    getAdminPaymentMetrics(),
    getAdminMerchantMetrics(),
    getAdminProviderMetrics(),
    getAdminGrowthMetrics(),
    getAdminRecentTransactions(10),
    getAdminRecentTickets(5),
    getAdminRecentFeedback(5),
  ])

  const [r0, r1, r2, r3, r4, r5, r6] = results

  const paymentMetrics = settled(r0, PAYMENT_METRICS_DEFAULT, "paymentMetrics")
  const merchantMetrics = settled(r1, MERCHANT_METRICS_DEFAULT, "merchantMetrics")
  const providerMetrics = settled(r2, PROVIDER_METRICS_DEFAULT, "providerMetrics")
  const growth = settled(r3, GROWTH_METRICS_DEFAULT, "growthMetrics")
  const recentTransactions = settled(r4, [] as AdminRecentTransaction[], "recentTransactions")
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
