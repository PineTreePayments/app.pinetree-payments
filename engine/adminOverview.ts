import {
  getAdminPaymentMetrics,
  getAdminMerchantMetrics,
  getAdminProviderMetrics,
  getAdminRecentTransactions,
  getAdminRecentTickets,
  getAdminRecentFeedback,
  type AdminOverviewMetrics,
  type AdminRecentTransaction,
  type AdminRecentTicket,
  type AdminRecentFeedback,
} from "@/database/adminOverview"

export type AdminOverviewResult = {
  metrics: AdminOverviewMetrics
  recentTransactions: AdminRecentTransaction[]
  recentTickets: AdminRecentTicket[]
  recentFeedback: AdminRecentFeedback[]
  generatedAt: string
}

export async function getAdminOverview(): Promise<AdminOverviewResult> {
  const [paymentMetrics, merchantMetrics, providerMetrics, recentTransactions, recentTickets, recentFeedback] =
    await Promise.all([
      getAdminPaymentMetrics(),
      getAdminMerchantMetrics(),
      getAdminProviderMetrics(),
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
    recentTransactions,
    recentTickets,
    recentFeedback,
    generatedAt: new Date().toISOString(),
  }
}
