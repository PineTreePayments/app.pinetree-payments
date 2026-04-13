import { supabaseAdmin, supabase, getLedgerEntriesByMerchantId } from "@/database"

const db = supabaseAdmin || supabase

type PaymentRow = {
  created_at: string
  total_amount: number
  currency: string
  status: string
}

type TransactionRow = {
  id: string
  provider: string
  status: string
  provider_transaction_id: string
  network: string | null
  channel?: string | null
  payments: PaymentRow | PaymentRow[] | null
  created_at?: string
}

export type TransactionsChartRow = {
  time: string
  solana: number
  base: number
  coinbase: number
  shift4: number
}

export type TransactionsDashboardData = {
  transactions: TransactionRow[]
  todayVolume: number
  todayTransactions: number
  confirmedRate: number
}

function bucket(label: string): TransactionsChartRow {
  return {
    time: label,
    solana: 0,
    base: 0,
    coinbase: 0,
    shift4: 0
  }
}

function buildBuckets(range: string) {
  const buckets: Record<string, TransactionsChartRow> = {}
  const start = new Date()

  if (range === "24h") {
    for (let i = 23; i >= 0; i--) {
      const d = new Date()
      d.setHours(d.getHours() - i)
      const label = `${d.getHours()}:00`
      buckets[label] = bucket(label)
    }
    start.setHours(start.getHours() - 24)
  }

  if (range === "7d") {
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const label = d.toLocaleDateString()
      buckets[label] = bucket(label)
    }
    start.setDate(start.getDate() - 7)
  }

  if (range === "1m") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const label = d.toLocaleDateString()
      buckets[label] = bucket(label)
    }
    start.setMonth(start.getMonth() - 1)
  }

  if (range === "3m") {
    for (let i = 89; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const label = d.toLocaleDateString()
      buckets[label] = bucket(label)
    }
    start.setMonth(start.getMonth() - 3)
  }

  if (range === "6m") {
    for (let i = 179; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const label = d.toLocaleDateString()
      buckets[label] = bucket(label)
    }
    start.setMonth(start.getMonth() - 6)
  }

  if (range === "1y") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const label = d.toLocaleString("default", { month: "short" })
      buckets[label] = bucket(label)
    }
    start.setFullYear(start.getFullYear() - 1)
  }

  return { buckets, start }
}

export async function getTransactionsDashboardEngine(merchantId: string): Promise<TransactionsDashboardData> {
  const ledgerEntries = await getLedgerEntriesByMerchantId(merchantId, 100)
  
  const txRows = ledgerEntries.map(entry => ({
    id: entry.id,
    provider: entry.provider,
    status: entry.status,
    provider_transaction_id: entry.transaction_id,
    network: entry.network,
    channel: null,
    created_at: entry.created_at?.toISOString(),
    payments: {
      created_at: entry.created_at?.toISOString(),
      total_amount: entry.amount,
      currency: entry.asset,
      status: entry.status
    }
  }))

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data: paymentRows, error: paymentError } = await db
    .from("payments")
    .select("total_amount,status")
    .eq("merchant_id", merchantId)
    .gte("created_at", startOfDay.toISOString())

  if (paymentError) {
    throw new Error(`Failed to load transaction analytics: ${paymentError.message}`)
  }

  const safePayments = paymentRows || []
  const todayVolume = safePayments.reduce((sum, p) => sum + Number(p.total_amount || 0), 0)
  const todayTransactions = safePayments.length
  const confirmed = safePayments.filter((p) => p.status === "CONFIRMED").length

  return {
    transactions: (txRows || []) as TransactionRow[],
    todayVolume,
    todayTransactions,
    confirmedRate: todayTransactions ? Math.round((confirmed / todayTransactions) * 100) : 0
  }
}

export async function getTransactionsChartEngine(
  merchantId: string,
  range: string,
  mode: "all" | "pos" | "online"
) {
  const { buckets, start } = buildBuckets(range)

  const { data, error } = await db
    .from("transactions")
    .select(`
      provider,
      channel,
      created_at,
      payments(total_amount)
    `)
    .eq("merchant_id", merchantId)
    .gte("created_at", start.toISOString())

  if (error) {
    throw new Error(`Failed to load chart data: ${error.message}`)
  }

  const rows = (data || []) as Array<{
    provider: string
    channel?: string | null
    created_at: string
    payments?: { total_amount?: number | string | null } | Array<{ total_amount?: number | string | null }> | null
  }>

  rows.forEach((tx) => {
    if (mode === "pos" && tx.channel !== "pos") return
    if (mode === "online" && tx.channel !== "online") return

    const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
    const amount = Number(payment?.total_amount || 0)

    const d = new Date(tx.created_at)
    let label = ""

    if (range === "24h") label = `${d.getHours()}:00`
    if (range === "7d" || range === "1m" || range === "3m" || range === "6m") {
      label = d.toLocaleDateString()
    }
    if (range === "1y") {
      label = d.toLocaleString("default", { month: "short" })
    }

    if (!buckets[label]) return

    if (tx.provider === "solana") buckets[label].solana += amount
    if (tx.provider === "base") buckets[label].base += amount
    if (tx.provider === "coinbase") buckets[label].coinbase += amount
    if (tx.provider === "shift4") buckets[label].shift4 += amount
  })

  return Object.values(buckets)
}
