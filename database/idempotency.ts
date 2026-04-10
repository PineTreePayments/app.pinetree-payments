import { supabase } from "./supabase"

export type IdempotencyKey = {
  key: string
  payment_id: string
  created_at: string
}

/**
 * Check if an idempotency key exists and return the associated payment ID
 */
export async function getIdempotencyKey(key: string) {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("payment_id")
    .eq("key", key)
    .maybeSingle()

  if (error) {
    return null
  }

  return data?.payment_id || null
}

/**
 * Store a new idempotency key
 */
export async function storeIdempotencyKey(key: string, paymentId: string) {
  const { error } = await supabase
    .from("idempotency_keys")
    .insert({
      key,
      payment_id: paymentId
    })

  if (error) {
    // Check for duplicate key error
    if (error.code === "23505") {
      return false
    }
    throw new Error(`Failed to store idempotency key: ${error.message}`)
  }

  return true
}

/**
 * Get payment by idempotency key (convenience method)
 */
export async function getPaymentByIdempotencyKey(key: string) {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("payment_id")
    .eq("key", key)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("*")
    .eq("id", data.payment_id)
    .single()

  if (paymentError) {
    return null
  }

  return payment
}