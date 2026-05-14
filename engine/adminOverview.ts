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
} from "@/database/adminOverview"

export type AdminOverviewResult = {
  metrics: AdminOverviewMetrics
  growth: AdminGrowthMetrics
  recentTransactions: AdminRecentTransaction[]
  recentTickets: AdminRecentTicket[]
  recentFeedback: AdminRecentFeedback[]
  generatedAt: string
}

export async function getAdminOverview(): Promise<AdminOverviewResult> {
  const [
    paymentMetrics,
    merchantMetrics,
    providerMetrics,
    growth,
    recentTransactions,
    recentTickets,
    recentFeedback,
  ] = await Promise.all([
    getAdminPaymentMetrics(),
    getAdminMerchantMetrics(),
    getAdminProviderMetrics(),
    getAdminGrowthMetrics(),
    getAdminRecentTransactions(10),
    getAdminRecentTickets(5),
    getAdminRecentFeedback(5),
  ])

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
