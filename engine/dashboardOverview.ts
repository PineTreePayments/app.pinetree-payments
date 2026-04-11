import { supabaseAdmin, supabase } from "@/lib/database"
import { getWalletOverviewEngine } from "./walletOverview"

const db = supabaseAdmin || supabase

type PaymentSummary = {
  subtotal_amount?: number | string | null
}

type TransactionRow = {
  id: string
  status: string
  network?: string | null
  created_at: string
  payments?: PaymentSummary | PaymentSummary[] | null
}

export type DashboardOverviewResult = {
  volume: number
  txCount: number
  successRate: number
  providers: number
  recentTx: TransactionRow[]
  chartData: Array<{ date: string; volume: number }>
  walletValue: number
  lastRun: string | null
}

export async function getDashboardOverviewEngine(merchantId: string): Promise<DashboardOverviewResult> {
  const walletOverview = await getWalletOverviewEngine(merchantId, { refresh: false })

  const { data: tx } = await db
    .from("transactions")
    .select(`
      id,
      status,
      network,
      created_at,
      payments (
        subtotal_amount
      )
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })

  const rows = (tx || []) as TransactionRow[]
  const totalTx = rows.length
  const successTx = rows.filter((t) => t.status === "CONFIRMED")

  const totalVolume = rows.reduce((sum: number, t) => {
    const payment = Array.isArray(t.payments) ? t.payments[0] : t.payments
    return sum + Number(payment?.subtotal_amount ?? 0)
  }, 0)

  const byDate: Record<string, number> = {}
  rows.forEach((t) => {
    const payment = Array.isArray(t.payments) ? t.payments[0] : t.payments
    const date = new Date(t.created_at).toLocaleDateString()
    byDate[date] = (byDate[date] || 0) + Number(payment?.subtotal_amount ?? 0)
  })

  const chartData = Object.keys(byDate).map((date) => ({
    date,
    volume: byDate[date]
  })).reverse()

  const { count } = await db
    .from("merchant_providers")
    .select("*", { count: "exact", head: true })
    .eq("merchant_id", merchantId)
    .eq("status", "connected")

  // Normalize network names with proper capitalization
  const normalizedRecentTx = rows.slice(0, 10).map(tx => ({
    ...tx,
    network: tx.network ? tx.network.charAt(0).toUpperCase() + tx.network.slice(1).toLowerCase() : tx.network
  }))

  return {
    volume: totalVolume,
    txCount: totalTx,
    successRate: totalTx > 0 ? Math.round((successTx.length / totalTx) * 100) : 0,
    providers: count ?? 0,
    recentTx: normalizedRecentTx,
    chartData,
    walletValue: walletOverview.totalUsd,
    lastRun: walletOverview.lastRun
  }
}

export async function syncDashboardOverviewEngine(merchantId: string): Promise<DashboardOverviewResult> {
  await getWalletOverviewEngine(merchantId, { refresh: true })
  return getDashboardOverviewEngine(merchantId)
}
