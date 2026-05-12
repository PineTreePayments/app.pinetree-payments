import { supabaseAdmin, supabase } from "@/database"
import { getWalletOverviewEngine } from "./walletOverview"

const db = supabaseAdmin || supabase

type PaymentSummary = {
  id?: string | null
  gross_amount?: number | string | null
  currency?: string | null
  status?: string | null
  provider_reference?: string | null
  created_at?: string | null
}

type TransactionRow = {
  id: string
  payment_id?: string | null
  status: string
  provider?: string | null
  provider_transaction_id?: string | null
  network?: string | null
  channel?: string | null
  created_at: string
  payments?: PaymentSummary | PaymentSummary[] | null
}

type OverviewPaymentRow = {
  created_at: string
  gross_amount?: number | string | null
  status?: string | null
}

function displayNetworkName(network: string | null | undefined) {
  const normalized = String(network || "").toLowerCase().trim()
  if (!normalized) return network || null
  if (normalized === "cash") return "Cash"
  if (normalized === "solana") return "Solana"
  if (normalized === "base") return "Base"
  if (normalized === "ethereum") return "Ethereum"
  if (normalized === "bitcoin_lightning") return "Bitcoin Lightning"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
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

  const [{ data: tx }, { data: payments, error: paymentError }] = await Promise.all([
    db
    .from("transactions")
    .select(`
      id,
      payment_id,
      status,
      provider,
      provider_transaction_id,
      network,
      channel,
      created_at,
      payments (
        id,
        created_at,
        gross_amount,
        currency,
        status,
        provider_reference,
        metadata
      )
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false }),
    db
      .from("payments")
      .select("created_at,gross_amount,status")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
  ])

  if (paymentError) {
    throw new Error(`Failed to load dashboard payment aggregates: ${paymentError.message}`)
  }

  const rows = (tx || []) as TransactionRow[]
  const paymentRows = (payments || []) as OverviewPaymentRow[]
  const totalTx = paymentRows.length
  const successTx = paymentRows.filter((payment) => payment.status === "CONFIRMED")

  const totalVolume = paymentRows.reduce((sum: number, payment) => {
    return sum + Number(payment.gross_amount ?? 0)
  }, 0)

  const byDate: Record<string, number> = {}
  paymentRows.forEach((payment) => {
    const date = new Date(payment.created_at).toLocaleDateString()
    byDate[date] = (byDate[date] || 0) + Number(payment.gross_amount ?? 0)
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
    network: displayNetworkName(tx.network)
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
