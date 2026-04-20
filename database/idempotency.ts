import crypto from "crypto"
import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
const supabase = supabaseAdmin || supabaseAnon

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

export async function claimIdempotencyKey(key: string, paymentId: string): Promise<
  | { status: "claimed"; paymentId: string }
  | { status: "existing"; paymentId: string }
> {
  const normalizedKey = String(key || "").trim()
  const normalizedPaymentId = String(paymentId || "").trim()

  if (!normalizedKey || !normalizedPaymentId) {
    throw new Error("Invalid idempotency claim")
  }

  const { error } = await supabase
    .from("idempotency_keys")
    .insert({
      id: crypto.randomUUID(),
      key: normalizedKey,
      payment_id: normalizedPaymentId
    })

  if (!error) {
    return {
      status: "claimed",
      paymentId: normalizedPaymentId
    }
  }

  if (error.code === "23505") {
    const existingPaymentId = await getIdempotencyKey(normalizedKey)
    if (!existingPaymentId) {
      throw new Error("Idempotency key collision detected but existing payment was not found")
    }

    return {
      status: "existing",
      paymentId: existingPaymentId
    }
  }

  throw new Error(`Failed to claim idempotency key: ${error.message}`)
}

export async function releaseIdempotencyKey(key: string, paymentId: string): Promise<void> {
  const normalizedKey = String(key || "").trim()
  const normalizedPaymentId = String(paymentId || "").trim()

  if (!normalizedKey || !normalizedPaymentId) {
    return
  }

  const { error } = await supabase
    .from("idempotency_keys")
    .delete()
    .eq("key", normalizedKey)
    .eq("payment_id", normalizedPaymentId)

  if (error) {
    throw new Error(`Failed to release idempotency key: ${error.message}`)
  }
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