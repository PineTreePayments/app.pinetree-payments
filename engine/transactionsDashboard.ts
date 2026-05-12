import { supabaseAdmin, supabase } from "@/database"

const db = supabaseAdmin || supabase

type PaymentRow = {
  id?: string | null
  created_at: string
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
  currency: string
  provider?: string | null
  network?: string | null
  status: string
  provider_reference?: string | null
  metadata?: Record<string, unknown> | null
}

type TransactionRow = {
  id: string
  payment_id?: string | null
  provider: string
  status: string
  provider_transaction_id: string
  network: string | null
  channel?: string | null
  total_amount?: number | string | null
  payments: PaymentRow | PaymentRow[] | null
  created_at?: string
}

export type TransactionsChartRow = {
  time: string
  solana: number
  base: number
  lightning: number
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
    lightning: 0,
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
      payment_id,
      provider,
      status,
      provider_transaction_id,
      network,
      channel,
      total_amount,
      created_at,
      payments (
        id,
        created_at,
        gross_amount,
        merchant_amount,
        pinetree_fee,
        currency,
        status,
        provider_reference
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

  const { data: paymentData, error: paymentError } = await db
    .from("payments")
    .select("id,provider,network,created_at,gross_amount,metadata")
    .eq("merchant_id", merchantId)
    .gte("created_at", start.toISOString())

  if (paymentError) {
    throw new Error(`Failed to load chart payment data: ${paymentError.message}`)
  }

  const payments = (paymentData || []) as PaymentRow[]
  const paymentIds = payments
    .map((payment) => String(payment.id || "").trim())
    .filter(Boolean)

  const channelByPaymentId = new Map<string, string | null>()

  if (paymentIds.length) {
    const { data: transactionData, error: transactionError } = await db
      .from("transactions")
      .select("payment_id,channel")
      .eq("merchant_id", merchantId)
      .in("payment_id", paymentIds)

    if (transactionError) {
      throw new Error(`Failed to load chart transaction channels: ${transactionError.message}`)
    }

    ;(transactionData || []).forEach((tx) => {
      const paymentId = String(tx.payment_id || "").trim()
      if (!paymentId || channelByPaymentId.has(paymentId)) return
      channelByPaymentId.set(paymentId, tx.channel || null)
    })
  }

  payments.forEach((payment) => {
    const paymentId = String(payment.id || "").trim()
    const metadataChannel =
      payment.metadata && typeof payment.metadata === "object"
        ? String(payment.metadata.channel || "").trim() || null
        : null
    const channel = channelByPaymentId.get(paymentId) || metadataChannel

    if (mode === "pos" && channel !== "pos") return
    if (mode === "online" && channel !== "online") return

    const amount = Number(payment.gross_amount ?? 0)

    const d = new Date(payment.created_at)
    let label = ""

    if (range === "24h") label = `${d.getHours()}:00`
    if (range === "7d" || range === "1m" || range === "3m" || range === "6m") {
      label = d.toLocaleDateString()
    }
    if (range === "1y") {
      label = d.toLocaleString("default", { month: "short" })
    }

    if (!buckets[label]) return

    if (payment.provider === "solana") buckets[label].solana += amount
    if (payment.provider === "base") buckets[label].base += amount
    if (payment.provider === "lightning") buckets[label].lightning += amount
    if (payment.provider === "coinbase") buckets[label].coinbase += amount
    if (payment.provider === "shift4") buckets[label].shift4 += amount
    if (payment.provider === "cash") buckets[label].cash += amount
  })

  return Object.values(buckets)
}
