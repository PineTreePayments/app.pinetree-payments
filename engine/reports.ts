import { getMerchantPaymentsForReport } from "@/database/reports"

type ReportInput = {
  merchantId: string
  startDate: string
  endDate: string
}

function displayProviderName(provider: string) {
  const normalized = String(provider || "").toLowerCase().trim()
  if (normalized === "lightning") return "Speed"
  if (normalized === "solana") return "Solana Pay"
  if (normalized === "base") return "Base Pay"
  if (normalized === "coinbase") return "Coinbase Business"
  if (normalized === "shift4") return "Shift4"
  if (normalized === "cash") return "Cash"
  return provider || "unknown"
}

function displayNetworkName(network: string) {
  const normalized = String(network || "").toLowerCase().trim()
  if (normalized === "bitcoin_lightning") return "Bitcoin Lightning"
  if (normalized === "solana") return "Solana"
  if (normalized === "base") return "Base"
  if (normalized === "ethereum") return "Ethereum"
  if (normalized === "cash") return "Cash"
  return network || "unknown"
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

    const amount = Number(payment.gross_amount || 0)
    const fee = Number(payment.pinetree_fee || 0)

    transactionCount++
    totalVolume += amount
    platformFeesInternal += fee

    const provider = displayProviderName(String(tx.provider || "unknown"))
    const channel = String(tx.channel || "unknown")
    const network = displayNetworkName(String(tx.network || "unknown"))

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
