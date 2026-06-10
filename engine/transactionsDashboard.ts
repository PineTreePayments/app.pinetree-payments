import { supabaseAdmin, supabase } from "@/database"
import { getPaymentStatusLabel } from "@/lib/utils/paymentStatus"

const db = supabaseAdmin || supabase

type PaymentRow = {
  id?: string | null
  created_at: string
  gross_amount?: number | string | null
  merchant_amount: number
  pinetree_fee: number
  currency: string
  provider?: string | null
  network?: string | null
  status: string
  displayStatus?: string
  provider_reference?: string | null
  metadata?: Record<string, unknown> | null
}

type TransactionRow = {
  id: string
  payment_id?: string | null
  provider: string
  status: string
  displayStatus?: string
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

type TransactionsChartProviderKey = Exclude<keyof TransactionsChartRow, "time">

type TransactionChartContext = {
  channel: string | null
  provider: string | null
  network: string | null
  totalAmount: number | string | null
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

function normalizeChartProvider(
  rawProvider?: string | null,
  rawNetwork?: string | null
): TransactionsChartProviderKey | null {
  const provider = String(rawProvider || "").toLowerCase().trim()
  const network = String(rawNetwork || "").toLowerCase().trim()

  if (provider === "solana" || network === "solana") return "solana"
  if (provider === "base" || network === "base") return "base"
  if (provider === "coinbase") return "coinbase"
  if (provider === "shift4" || network === "shift4") return "shift4"
  if (provider === "cash" || network === "cash") return "cash"

  if (
    provider === "lightning" ||
    provider === "lightning_speed" ||
    provider === "lightning_nwc" ||
    provider === "speed" ||
    provider === "nwc" ||
    provider === "btc_lightning" ||
    provider === "bitcoin_lightning" ||
    provider === "bitcoin lightning" ||
    network === "bitcoin_lightning" ||
    network === "btc_lightning" ||
    network === "lightning_btc" ||
    network === "lightning"
  ) {
    return "lightning"
  }

  return null
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key]
  if (typeof value !== "number" && typeof value !== "string") return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function centsToDollars(value: number | string | null | undefined) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric > 999 ? numeric / 100 : numeric
}

function getChartAmountUsd(
  payment: PaymentRow,
  transactionContext?: TransactionChartContext
) {
  const grossAmount = Number(payment.gross_amount ?? 0)
  if (Number.isFinite(grossAmount) && grossAmount > 0) return grossAmount

  const metadata = payment.metadata
  return (
    metadataNumber(metadata, "grossAmount") ||
    metadataNumber(metadata, "invoiceAmountUsd") ||
    metadataNumber(metadata, "amountUsd") ||
    metadataNumber(metadata, "usdAmount") ||
    metadataNumber(metadata, "fiat_amount_usd") ||
    metadataNumber(metadata, "normalized_amount_usd") ||
    centsToDollars(transactionContext?.totalAmount) ||
    0
  )
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
        provider_reference,
        metadata
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

  const transactions = ((txData || []) as TransactionRow[]).map((transaction) => {
    const payments = Array.isArray(transaction.payments)
      ? transaction.payments.map((payment) => ({
          ...payment,
          displayStatus: getPaymentStatusLabel(payment.status)
        }))
      : transaction.payments
        ? {
            ...transaction.payments,
            displayStatus: getPaymentStatusLabel(transaction.payments.status)
          }
        : null

    return {
      ...transaction,
      displayStatus: getPaymentStatusLabel(transaction.status),
      payments
    }
  })

  return {
    transactions,
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

  const transactionContextByPaymentId = new Map<string, TransactionChartContext>()

  if (paymentIds.length) {
    const { data: transactionData, error: transactionError } = await db
      .from("transactions")
      .select("payment_id,channel,provider,network,total_amount")
      .eq("merchant_id", merchantId)
      .in("payment_id", paymentIds)

    if (transactionError) {
      throw new Error(`Failed to load chart transaction channels: ${transactionError.message}`)
    }

    ;(transactionData || []).forEach((tx) => {
      const paymentId = String(tx.payment_id || "").trim()
      if (!paymentId || transactionContextByPaymentId.has(paymentId)) return
      transactionContextByPaymentId.set(paymentId, {
        channel: tx.channel || null,
        provider: tx.provider || null,
        network: tx.network || null,
        totalAmount: tx.total_amount || null
      })
    })
  }

  payments.forEach((payment) => {
    const paymentId = String(payment.id || "").trim()
    const metadataChannel =
      payment.metadata && typeof payment.metadata === "object"
        ? String(payment.metadata.channel || "").trim() || null
        : null
    const transactionContext = transactionContextByPaymentId.get(paymentId)
    const channel = transactionContext?.channel || metadataChannel

    if (mode === "pos" && channel !== "pos") return
    if (mode === "online" && channel !== "online") return

    const amount = getChartAmountUsd(payment, transactionContext)

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

    const chartProvider = normalizeChartProvider(
      payment.provider || transactionContext?.provider,
      payment.network || transactionContext?.network
    )

    if (!chartProvider) return
    buckets[label][chartProvider] += amount
  })

  return Object.values(buckets)
}
