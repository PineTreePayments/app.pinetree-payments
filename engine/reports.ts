import { getMerchantPaymentsForReport } from "@/database/reports"

type ReportInput = {
  merchantId: string
  startDate: string
  endDate: string
}

export async function generateReportEngine(input: ReportInput) {
  const payments = await getMerchantPaymentsForReport(input)

  let totalVolume = 0
  let platformFeesInternal = 0
  let transactionCount = 0
  let failedPayments = 0

  const providerTotals: Record<string, number> = {}
  const channelTotals: Record<string, number> = {}
  const networkTotals: Record<string, number> = {}

  const transactionsTable: Array<{
    date: string
    provider: string
    channel: string
    network: string
    amount: number
  }> = []

  for (const payment of payments) {
    const tx = payment.transactions?.[0]
    if (!tx) continue

    if (String(tx.status || "").toUpperCase() !== "CONFIRMED") {
      failedPayments++
      continue
    }

    const amount = Number(payment.total_amount || 0)
    const fee = Number(payment.platform_fee || 0)

    transactionCount++
    totalVolume += amount
    platformFeesInternal += fee

    const provider = String(tx.provider || "unknown")
    const channel = String(tx.channel || "unknown")
    const network = String(tx.network || "unknown")

    providerTotals[provider] = (providerTotals[provider] || 0) + amount
    channelTotals[channel] = (channelTotals[channel] || 0) + amount
    networkTotals[network] = (networkTotals[network] || 0) + amount

    transactionsTable.push({
      date: payment.created_at,
      provider,
      channel,
      network,
      amount
    })
  }

  const merchantNet = totalVolume - platformFeesInternal
  const avgTransaction = transactionCount > 0 ? totalVolume / transactionCount : 0
  const estimatedTax = merchantNet * 0.07

  return {
    totalVolume,
    merchantNet,
    estimatedTax,
    transactionCount,
    avgTransaction,
    failedPayments,
    providerTotals,
    channelTotals,
    networkTotals,
    transactionsTable
  }
}
