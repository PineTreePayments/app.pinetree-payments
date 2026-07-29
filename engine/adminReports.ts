import type {
  PlatformReportMetrics,
  PlatformReportMode,
  PlatformReportPeriod,
} from "@/database/adminReports"
import { getAllCanonicalTransactions } from "./canonicalTransactions"

export function resolvePlatformReportStart(period: PlatformReportPeriod, now = new Date()): string {
  switch (period) {
    case "7d": return new Date(now.getTime() - 7 * 86_400_000).toISOString()
    case "30d": return new Date(now.getTime() - 30 * 86_400_000).toISOString()
    case "month": return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    case "quarter": {
      const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
      return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1)).toISOString()
    }
    case "year": return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
  }
}

/** Admin reports use the same canonical projection as merchant transaction reads. */
export async function getPlatformReportEngine(
  period: PlatformReportPeriod = "30d",
  mode: PlatformReportMode = "all"
): Promise<PlatformReportMetrics> {
  const periodStart = resolvePlatformReportStart(period)
  const rows = await getAllCanonicalTransactions({
    scope: { type: "admin" },
    startDate: periodStart,
    mode,
  })

  let confirmedTransactions = 0
  let confirmedVolumeMinor = 0
  let pinetreeFeesMinor = 0
  let processingTransactions = 0
  let incompleteTransactions = 0
  let canceledTransactions = 0
  let failedTransactions = 0
  let expiredTransactions = 0
  let awaitingTransactions = 0
  const byNetwork: PlatformReportMetrics["byNetwork"] = {}
  const byProvider: PlatformReportMetrics["byProvider"] = {}
  const merchantVolume = new Map<string, { volumeMinor: number; count: number }>()

  for (const row of rows) {
    const network = row.network || "Unknown"
    const provider = row.provider || "unknown"
    byNetwork[network] ||= { total: 0, confirmed: 0, volume: 0, fees: 0 }
    byProvider[provider] ||= { total: 0, confirmed: 0, volume: 0, fees: 0 }
    byNetwork[network].total += 1
    byProvider[provider].total += 1

    switch (row.canonicalStatus) {
      case "CONFIRMED": {
        const feeMinor = row.feeAmountMinor ?? 0
        confirmedTransactions += 1
        confirmedVolumeMinor += row.amountMinor
        pinetreeFeesMinor += feeMinor
        byNetwork[network].confirmed += 1
        byNetwork[network].volume += row.amountMinor / 100
        byNetwork[network].fees += feeMinor / 100
        byProvider[provider].confirmed += 1
        byProvider[provider].volume += row.amountMinor / 100
        byProvider[provider].fees += feeMinor / 100
        const merchant = merchantVolume.get(row.merchantId) || { volumeMinor: 0, count: 0 }
        merchant.volumeMinor += row.amountMinor
        merchant.count += 1
        merchantVolume.set(row.merchantId, merchant)
        break
      }
      case "PROCESSING": processingTransactions += 1; break
      case "INCOMPLETE": incompleteTransactions += 1; break
      case "CANCELED": canceledTransactions += 1; break
      case "FAILED": failedTransactions += 1; break
      case "EXPIRED": expiredTransactions += 1; break
      case "CREATED":
      case "PENDING": awaitingTransactions += 1; break
    }
  }

  const topMerchants = [...merchantVolume.entries()]
    .map(([merchantId, value]) => ({
      merchantId,
      confirmedVolume: value.volumeMinor / 100,
      confirmedCount: value.count,
    }))
    .sort((left, right) => right.confirmedVolume - left.confirmedVolume)
    .slice(0, 10)

  return {
    period,
    mode,
    periodStart,
    totalTransactions: rows.length,
    confirmedTransactions,
    confirmedVolume: confirmedVolumeMinor / 100,
    pinetreeFees: pinetreeFeesMinor / 100,
    processingTransactions,
    incompleteTransactions,
    canceledTransactions,
    failedTransactions,
    expiredTransactions,
    awaitingTransactions,
    byNetwork,
    byProvider,
    topMerchants,
    generatedAt: new Date().toISOString(),
  }
}
