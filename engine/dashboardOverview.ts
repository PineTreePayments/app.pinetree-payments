import { supabaseAdmin, supabase } from "@/database"
import { getAllCanonicalTransactions, type CanonicalTransaction } from "./canonicalTransactions"
import { getWalletOverviewEngine } from "./walletOverview"
import { getInventoryEngine } from "./inventory"
import {
  buildOverviewRailReadiness,
  getProvidersDashboardEngine,
  type OverviewRailReadiness,
} from "./providersDashboard"
import { getMerchantBusinessProfile, type MerchantBusinessProfile } from "./businessProfile"
import {
  formatInMerchantTimeZone,
  normalizeTimeZone,
  resolveMerchantReportRange,
} from "./reportPeriods"
import {
  summarizeCanonicalTransactionActivity,
  toMerchantTransactionReadRow,
  type MerchantTransactionReadRow,
} from "./transactionsDashboard"

const db = supabaseAdmin || supabase

export type DashboardOverviewResult = {
  volume: number
  txCount: number
  successRate: number
  providers: number
  recentTx: MerchantTransactionReadRow[]
  chartData: Array<{ date: string; volume: number }>
  walletValue: number
  lastRun: string | null
  timeZone: string
  today: {
    volume: number
    transactionCount: number
    averageTransaction: number
    confirmed: number
    incomplete: number
    canceled: number
    failed: number
  }
  railBreakdown: Record<string, { count: number; volume: number }>
  railReadiness: OverviewRailReadiness[]
  inventory: {
    available: boolean
    totalItems: number
    lowStock: number
    outOfStock: number
    connectedProviders: number
    lastSyncAt: string | null
  }
  businessProfile: Pick<MerchantBusinessProfile, "profile_status" | "missing_fields">
}

function occurredWithin(row: CanonicalTransaction, startDate: string, endDate: string) {
  const occurredAt = Date.parse(row.occurredAt)
  return Number.isFinite(occurredAt) &&
    occurredAt >= Date.parse(startDate) &&
    occurredAt <= Date.parse(endDate)
}

async function getMerchantTimeZone(merchantId: string): Promise<string> {
  const { data, error } = await db
    .from("merchant_settings")
    .select("timezone")
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load merchant timezone: ${error.message}`)
  return normalizeTimeZone(data?.timezone)
}

export async function getDashboardOverviewEngine(merchantId: string): Promise<DashboardOverviewResult> {
  const scope = { type: "merchant" as const, merchantId }
  const [
    walletOverview,
    inventoryOverview,
    providersOverview,
    businessProfile,
    timeZone,
    canonicalRows,
  ] = await Promise.all([
    getWalletOverviewEngine(merchantId, { refresh: false }),
    getInventoryEngine(merchantId),
    getProvidersDashboardEngine(merchantId),
    getMerchantBusinessProfile(merchantId),
    getMerchantTimeZone(merchantId),
    getAllCanonicalTransactions({ scope }),
  ])

  const allTime = summarizeCanonicalTransactionActivity(canonicalRows)
  const confirmedRows = canonicalRows.filter((row) => row.canonicalStatus === "CONFIRMED")
  const byDate: Record<string, number> = {}
  confirmedRows.forEach((row) => {
    const date = formatInMerchantTimeZone(row.occurredAt, timeZone).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    byDate[date] = (byDate[date] || 0) + row.amountMinor / 100
  })

  const chartData = Object.keys(byDate)
    .sort()
    .map((date) => ({ date, volume: byDate[date] }))

  const todayRange = resolveMerchantReportRange({ type: "today", timeZone })
  const todayRows = canonicalRows.filter((row) =>
    occurredWithin(row, todayRange.startDate, todayRange.endDate)
  )
  const today = summarizeCanonicalTransactionActivity(todayRows)
  const railBreakdown = todayRows.reduce<Record<string, { count: number; volume: number }>>(
    (result, row) => {
      const key = row.network.toLowerCase().replace(/\s+/g, "_") || "unknown"
      const current = result[key] || { count: 0, volume: 0 }
      current.count += 1
      if (row.canonicalStatus === "CONFIRMED") current.volume += row.amountMinor / 100
      result[key] = current
      return result
    },
    {}
  )

  const railReadiness = buildOverviewRailReadiness(providersOverview)

  return {
    volume: allTime.volume,
    txCount: allTime.transactionCount,
    successRate: allTime.confirmedRate,
    providers: railReadiness.filter((rail) => rail.status === "Connected").length,
    recentTx: canonicalRows.slice(0, 10).map(toMerchantTransactionReadRow),
    chartData,
    walletValue: walletOverview.totalUsd,
    lastRun: walletOverview.lastRun,
    timeZone,
    today: {
      volume: today.volume,
      transactionCount: today.transactionCount,
      averageTransaction: today.confirmedCount > 0 ? today.volume / today.confirmedCount : 0,
      confirmed: today.confirmedCount,
      incomplete: todayRows.filter((row) => row.canonicalStatus === "INCOMPLETE").length,
      canceled: todayRows.filter((row) => row.canonicalStatus === "CANCELED").length,
      failed: todayRows.filter((row) => row.canonicalStatus === "FAILED").length,
    },
    railBreakdown,
    railReadiness,
    inventory: {
      available: inventoryOverview.available,
      totalItems: inventoryOverview.summary.totalItems,
      lowStock: inventoryOverview.summary.lowStock,
      outOfStock: inventoryOverview.summary.outOfStock,
      connectedProviders: inventoryOverview.integrations.filter((integration) => integration.status === "CONNECTED").length,
      lastSyncAt: inventoryOverview.integrations
        .map((integration) => integration.lastSyncAt || null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null,
    },
    businessProfile: {
      profile_status: businessProfile.profile_status,
      missing_fields: businessProfile.missing_fields,
    },
  }
}

export async function syncDashboardOverviewEngine(merchantId: string): Promise<DashboardOverviewResult> {
  await getWalletOverviewEngine(merchantId, { refresh: true })
  return getDashboardOverviewEngine(merchantId)
}
