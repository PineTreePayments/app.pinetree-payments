import { supabase, supabaseAdmin } from "./supabase"

export type PaymentStatus = "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "REFUNDED"

export type Payment = {
  id: string
  merchant_id: string
  merchant_amount: number
  pinetree_fee: number
  gross_amount: number
  currency: string
  provider: string
  provider_reference?: string
  status: PaymentStatus
  network?: string
  payment_url?: string
  qr_code_url?: string
  metadata?: any
  created_at: string
  updated_at: string
}

export type CreatePaymentInput = {
  id: string
  merchant_id: string
  merchant_amount: number
  pinetree_fee: number
  gross_amount: number
  currency: string
  provider: string
  network?: string
  payment_url?: string
  qr_code_url?: string
  metadata?: any
}

/**
 * Create a new payment record in the database
 */
export async function createPayment(input: CreatePaymentInput) {
  const { data, error } = await supabase
    .from("payments")
    .insert({
      id: input.id,
      merchant_id: input.merchant_id,
      merchant_amount: input.merchant_amount,
      pinetree_fee: input.pinetree_fee,
      gross_amount: input.gross_amount,
      currency: input.currency,
      provider: input.provider,
      network: input.network,
      payment_url: input.payment_url,
      qr_code_url: input.qr_code_url,
      metadata: input.metadata,
      status: "PENDING"
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create payment: ${error.message}`)
  }

  return data as Payment
}

/**
 * Get a payment by ID
 */
export async function getPaymentById(paymentId: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single()

  if (error) {
    return null
  }

  return data as Payment | null
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus
) {
  const { data, error } = await supabase
    .from("payments")
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq("id", paymentId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update payment status: ${error.message}`)
  }

  return data as Payment
}

/**
 * Update payment with provider reference
 */
export async function updatePaymentProviderReference(
  paymentId: string,
  providerReference: string
) {
  const { data, error } = await supabase
    .from("payments")
    .update({
      provider_reference: providerReference,
      updated_at: new Date().toISOString()
    })
    .eq("id", paymentId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update provider reference: ${error.message}`)
  }

  return data as Payment
}

/**
 * Get payments by merchant ID
 */
export async function getPaymentsByMerchant(
  merchantId: string,
  limit: number = 50,
  offset: number = 0
) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(`Failed to fetch payments: ${error.message}`)
  }

  return data as Payment[]
}

/**
 * Get payments by status
 */
export async function getPaymentsByStatus(
  status: PaymentStatus,
  limit: number = 50
) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("status", status)
    .limit(limit)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch payments: ${error.message}`)
  }

  return data as Payment[]
}

/**
 * Get merchant payment statistics
 */
export async function getMerchantPaymentStats(merchantId: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("status, gross_amount, pinetree_fee")
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed to fetch payment stats: ${error.message}`)
  }

  const stats = {
    totalVolume: 0,
    totalTransactions: data.length,
    confirmedTransactions: 0,
    failedTransactions: 0,
    pendingTransactions: 0,
    totalFees: 0
  }

  data.forEach((payment: any) => {
    const amount = Number(payment.gross_amount || 0)
    const fee = Number(payment.pinetree_fee || 0)

    stats.totalVolume += amount
    stats.totalFees += fee

    if (payment.status === "CONFIRMED") {
      stats.confirmedTransactions++
    } else if (payment.status === "FAILED") {
      stats.failedTransactions++
    } else if (payment.status === "PENDING" || payment.status === "PROCESSING") {
      stats.pendingTransactions++
    }
  })

  return stats
}

/**
 * Get daily volume for a merchant
 */
export async function getMerchantDailyVolume(
  merchantId: string,
  days: number = 30
) {
  const { data, error } = await supabase
    .from("payments")
    .select("created_at, gross_amount")
    .eq("merchant_id", merchantId)
    .eq("status", "CONFIRMED")
    .gte("created_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch daily volume: ${error.message}`)
  }

  // Group by date
  const dailyVolume: Record<string, number> = {}

  data.forEach((payment: any) => {
    const date = new Date(payment.created_at).toLocaleDateString()
    dailyVolume[date] = (dailyVolume[date] || 0) + Number(payment.gross_amount || 0)
  })

  return Object.entries(dailyVolume).map(([date, volume]) => ({
    date,
    volume
  }))
}