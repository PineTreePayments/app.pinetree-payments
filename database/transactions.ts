import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
const supabase = supabaseAdmin || supabaseAnon

export type TransactionStatus = "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "REFUNDED"

export type Transaction = {
  id: string
  payment_id: string
  merchant_id: string
  provider: string
  provider_transaction_id?: string
  network?: string
  status: TransactionStatus
  channel?: "pos" | "online" | "api" | "invoice"
  created_at: string
  updated_at: string
}

export type CreateTransactionInput = {
  id: string
  payment_id: string
  merchant_id: string
  provider: string
  network?: string
  channel?: "pos" | "online" | "api" | "invoice"
  provider_transaction_id?: string
  total_amount?: number
  platform_fee?: number
  subtotal_amount?: number
  status?: TransactionStatus
}

/**
 * Create a new transaction record
 */
export async function createTransaction(input: CreateTransactionInput) {
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      id: input.id,
      payment_id: input.payment_id,
      merchant_id: input.merchant_id,
      provider: input.provider,
      network: input.network,
      channel: input.channel || "pos",
      provider_transaction_id: input.provider_transaction_id,
      total_amount: input.total_amount,
      platform_fee: input.platform_fee,
      subtotal_amount: input.subtotal_amount,
      status: input.status || "PENDING"
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create transaction: ${error.message}`)
  }

  return data as Transaction
}

/**
 * Get transaction by ID
 */
export async function getTransactionById(transactionId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single()

  if (error) {
    return null
  }

  return data as Transaction | null
}

/**
 * Get transaction by payment ID
 */
export async function getTransactionByPaymentId(paymentId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("payment_id", paymentId)
    .single()

  if (error) {
    return null
  }

  return data as Transaction | null
}

/**
 * Get transaction by provider transaction ID
 */
export async function getTransactionByProviderReference(providerTransactionId: string) {
  const normalized = String(providerTransactionId || "").trim()
  if (!normalized) return null

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("provider_transaction_id", normalized)
    .single()

  if (error) {
    return null
  }

  return data as Transaction | null
}

/**
 * Update transaction status
 */
export async function updateTransactionStatus(
  transactionId: string,
  status: TransactionStatus
) {
  const { data, error } = await supabase
    .from("transactions")
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq("id", transactionId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update transaction status: ${error.message}`)
  }

  return data as Transaction
}

/**
 * Update transaction with provider transaction ID
 */
export async function updateTransactionProviderReference(
  transactionId: string,
  providerTransactionId: string
) {
  const { data, error } = await supabase
    .from("transactions")
    .update({
      provider_transaction_id: providerTransactionId,
      updated_at: new Date().toISOString()
    })
    .eq("id", transactionId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update provider transaction ID: ${error.message}`)
  }

  return data as Transaction
}

/**
 * Get transactions by merchant ID
 */
export async function getTransactionsByMerchant(
  merchantId: string,
  limit: number = 50,
  offset: number = 0
) {
  const { data, error } = await supabase
    .from("transactions")
    .select(`
      *,
      payments (
        gross_amount,
        merchant_amount,
        pinetree_fee
      )
    `)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(`Failed to fetch transactions: ${error.message}`)
  }

  return data as (Transaction & { payments?: Record<string, unknown> | null })[]
}

/**
 * Get recent transactions for dashboard
 */
export async function getRecentTransactions(
  merchantId: string,
  limit: number = 10
) {
  const { data, error } = await supabase
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
    .limit(limit)

  if (error) {
    return []
  }

  return data || []
}

/**
 * Get transaction statistics for a merchant
 */
export async function getTransactionStats(merchantId: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("status, network")
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed to fetch transaction stats: ${error.message}`)
  }

  const stats = {
    totalTransactions: data.length,
    confirmedTransactions: 0,
    failedTransactions: 0,
    pendingTransactions: 0,
    networks: {} as Record<string, number>
  }

  type TransactionStatsRow = { status?: string | null; network?: string | null }

  data.forEach((tx: TransactionStatsRow) => {
    if (tx.status === "CONFIRMED") {
      stats.confirmedTransactions++
    } else if (tx.status === "FAILED") {
      stats.failedTransactions++
    } else {
      stats.pendingTransactions++
    }

    const network = tx.network || "unknown"
    stats.networks[network] = (stats.networks[network] || 0) + 1
  })

  return stats
}