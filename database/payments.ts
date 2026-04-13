ouimport { supabase } from "./supabase"

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"
  | "EXPIRED"
  | "REFUNDED"

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
  metadata?: unknown
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
  provider_reference?: string
  network?: string
  payment_url?: string
  qr_code_url?: string
  metadata?: unknown
  status?: PaymentStatus
}

function mapSchemaError(message: string): string {
  if (
    message.includes("gross_amount") &&
    message.includes("schema cache")
  ) {
    return "Failed to create payment: database schema is out of date. Missing column payments.gross_amount. Run the DB migration for payments gross_amount and reload PostgREST schema cache."
  }

  return `Failed to create payment: ${message}`
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
      provider_reference: input.provider_reference,
      network: input.network,
      payment_url: input.payment_url,
      qr_code_url: input.qr_code_url,
      metadata: input.metadata,
      status: input.status || "CREATED"
    })
    .select()
    .single()

  if (error) {
    throw new Error(mapSchemaError(error.message))
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
 * Get a payment by provider reference
 */
export async function getPaymentByProviderReference(providerReference: string) {
  const normalized = String(providerReference || "").trim()
  if (!normalized) return null

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("provider_reference", normalized)
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

  type PaymentStatsRow = { status?: string | null; gross_amount?: number | string | null; pinetree_fee?: number | string | null }

  data.forEach((payment: PaymentStatsRow) => {
    const amount = Number(payment.gross_amount || 0)
    const fee = Number(payment.pinetree_fee || 0)

    stats.totalVolume += amount
    stats.totalFees += fee

    if (payment.status === "CONFIRMED") {
      stats.confirmedTransactions++
    } else if (payment.status === "FAILED" || payment.status === "INCOMPLETE") {
      stats.failedTransactions++
    } else if (
      payment.status === "CREATED" ||
      payment.status === "PENDING" ||
      payment.status === "PROCESSING"
    ) {
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

  type PaymentDailyVolumeRow = { created_at?: string | null; gross_amount?: number | string | null }

  data.forEach((payment: PaymentDailyVolumeRow) => {
    if (!payment.created_at) return
    const date = new Date(payment.created_at).toLocaleDateString()
    dailyVolume[date] = (dailyVolume[date] || 0) + Number(payment.gross_amount || 0)
  })

  return Object.entries(dailyVolume).map(([date, volume]) => ({
    date,
    volume
  }))
}