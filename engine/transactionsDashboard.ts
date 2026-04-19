import { supabaseAdmin, supabase } from "@/database"

const db = supabaseAdmin || supabase

type PaymentRow = {
  created_at: string
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
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
  cash: number
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
    shift4: 0,
    cash: 0
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
  // Use transactions table directly — includes cash, crypto, and all channels
  const { data: txData, error: txError } = await db
    .from("transactions")
    .select(`
      id,
      provider,
      status,
      provider_transaction_id,
      network,
      channel,
      created_at,
      payments (
        created_at,
        gross_amount,
        merchant_amount,
        pinetree_fee,
        currency,
        status
      )
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (txError) {
    throw new Error(`Failed to load transactions: ${txError.message}`)
  }

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data: paymentRows, error: paymentError } = await db
    .from("payments")
    .select("gross_amount,status")
    .eq("merchant_id", merchantId)
    .gte("created_at", startOfDay.toISOString())

  if (paymentError) {
    throw new Error(`Failed to load transaction analytics: ${paymentError.message}`)
  }

  const safePayments = paymentRows || []
  const todayVolume = safePayments.reduce((sum, p) => sum + Number(p.gross_amount || 0), 0)
  const todayTransactions = safePayments.length
  const confirmed = safePayments.filter((p) => p.status === "CONFIRMED").length

  return {
    transactions: (txData || []) as TransactionRow[],
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
      payments(gross_amount)
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
    payments?: { gross_amount?: number | string | null } | Array<{ gross_amount?: number | string | null }> | null
  }>

  rows.forEach((tx) => {
    if (mode === "pos" && tx.channel !== "pos") return
    if (mode === "online" && tx.channel !== "online") return

    const payment = Array.isArray(tx.payments) ? tx.payments[0] : tx.payments
    const amount = Number(payment?.gross_amount || 0)

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
    if (tx.provider === "cash") buckets[label].cash += amount
  })

  return Object.values(buckets)
}
