import { supabaseAdmin, supabase } from "@/database"
import { getWalletOverviewEngine } from "./walletOverview"
import { getInventoryEngine } from "./inventory"

const db = supabaseAdmin || supabase

type PaymentSummary = {
  id?: string | null
  gross_amount?: number | string | null
  currency?: string | null
  status?: string | null
  provider_reference?: string | null
  created_at?: string | null
  merchant_amount?: number | string | null
  pinetree_fee?: number | string | null
  updated_at?: string | null
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
  pinetree_fee?: number | string | null
  status?: string | null
  provider?: string | null
  network?: string | null
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
  today: {
    volume: number
    transactionCount: number
    averageTransaction: number
    pinetreeFees: number
    confirmed: number
    incomplete: number
    failed: number
  }
  railBreakdown: Record<string, { count: number; volume: number }>
  railReadiness: Array<{
    id: "solana" | "base" | "lightning"
    label: string
    connected: boolean
    detail: string
  }>
  inventory: {
    available: boolean
    totalItems: number
    lowStock: number
    outOfStock: number
    connectedProviders: number
    lastSyncAt: string | null
  }
}

export async function getDashboardOverviewEngine(merchantId: string): Promise<DashboardOverviewResult> {
  const [walletOverview, inventoryOverview] = await Promise.all([
    getWalletOverviewEngine(merchantId, { refresh: false }),
    getInventoryEngine(merchantId)
  ])

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
        merchant_amount,
        pinetree_fee,
        currency,
        status,
        provider_reference,
        updated_at,
        metadata
      )
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false }),
    db
      .from("payments")
      .select("created_at,gross_amount,pinetree_fee,status,provider,network")
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

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayPayments = paymentRows.filter((payment) => {
    const createdAt = new Date(payment.created_at)
    return !Number.isNaN(createdAt.getTime()) && createdAt >= todayStart
  })
  const confirmedToday = todayPayments.filter((payment) => payment.status === "CONFIRMED")
  const todayVolume = confirmedToday.reduce(
    (sum, payment) => sum + Number(payment.gross_amount ?? 0),
    0
  )
  const railBreakdown = todayPayments.reduce<Record<string, { count: number; volume: number }>>(
    (result, payment) => {
      const key = String(payment.network || payment.provider || "unknown").toLowerCase()
      const current = result[key] || { count: 0, volume: 0 }
      current.count += 1
      current.volume += Number(payment.gross_amount ?? 0)
      result[key] = current
      return result
    },
    {}
  )

  const walletNetworks = new Set(
    walletOverview.wallets.map((wallet) => String(wallet.network || "").toLowerCase())
  )
  const lightningRail = walletOverview.paymentRails[0]
  const railReadiness: DashboardOverviewResult["railReadiness"] = [
    {
      id: "solana",
      label: "Solana Pay",
      connected: walletNetworks.has("solana"),
      detail: walletNetworks.has("solana") ? "Merchant wallet connected" : "Connect a Solana wallet"
    },
    {
      id: "base",
      label: "Base Pay",
      connected: walletNetworks.has("base"),
      detail: walletNetworks.has("base") ? "Merchant wallet connected" : "Connect a Base wallet"
    },
    {
      id: "lightning",
      label: "Bitcoin Lightning",
      connected: Boolean(lightningRail),
      detail: lightningRail ? `${lightningRail.provider} connected` : "Connect Speed or an NWC wallet"
    }
  ]

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
    lastRun: walletOverview.lastRun,
    today: {
      volume: todayVolume,
      transactionCount: todayPayments.length,
      averageTransaction: confirmedToday.length > 0 ? todayVolume / confirmedToday.length : 0,
      pinetreeFees: confirmedToday.reduce(
        (sum, payment) => sum + Number(payment.pinetree_fee ?? 0),
        0
      ),
      confirmed: confirmedToday.length,
      incomplete: todayPayments.filter((payment) => payment.status === "INCOMPLETE").length,
      failed: todayPayments.filter((payment) => payment.status === "FAILED").length
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
        .at(-1) || null
    }
  }
}

export async function syncDashboardOverviewEngine(merchantId: string): Promise<DashboardOverviewResult> {
  await getWalletOverviewEngine(merchantId, { refresh: true })
  return getDashboardOverviewEngine(merchantId)
}
