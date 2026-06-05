import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type PaymentIntentStatus = "CREATED" | "SELECTED" | "EXPIRED"

export type PaymentIntent = {
  id: string
  merchant_id: string
  amount: number
  currency: string
  terminal_id?: string | null
  pinetree_fee: number
  metadata?: Record<string, unknown> | null
  available_networks: string[]
  selected_network?: string | null
  payment_id?: string | null
  status: PaymentIntentStatus
  expires_at: string
  created_at: string
  updated_at: string
}

export async function createPaymentIntent(input: {
  id: string
  merchant_id: string
  amount: number
  currency: string
  terminal_id?: string | null
  pinetree_fee: number
  metadata?: Record<string, unknown>
  available_networks: string[]
  expires_at?: string
}) {
  const expiresAt =
    input.expires_at ||
    new Date(Date.now() + 5 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from("payment_intents")
    .insert({
      id: input.id,
      merchant_id: input.merchant_id,
      amount: input.amount,
      currency: input.currency,
      terminal_id: input.terminal_id || null,
      pinetree_fee: input.pinetree_fee,
      metadata: input.metadata || null,
      available_networks: input.available_networks,
      status: "CREATED",
      expires_at: expiresAt
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to create payment intent: ${error.message}`)
  }

  return data as PaymentIntent
}

export async function getPaymentIntentById(intentId: string) {
  const { data, error } = await db
    .from("payment_intents")
    .select("*")
    .eq("id", intentId)
    .single()

  if (error) return null
  return data as PaymentIntent
}

export async function expirePaymentIntent(intentId: string): Promise<void> {
  const { error } = await db
    .from("payment_intents")
    .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
    .eq("id", intentId)
    .neq("status", "EXPIRED")

  if (error) {
    throw new Error(`Failed to expire payment intent: ${error.message}`)
  }
}

/**
 * Find the most recent non-expired payment intent linked to a specific payment.
 * Used by the stale payment sweep to expire the intent when a payment is swept
 * to INCOMPLETE, keeping payment_intents consistent with payment state.
 */
export async function getPaymentIntentByPaymentId(
  paymentId: string
): Promise<PaymentIntent | null> {
  const { data, error } = await db
    .from("payment_intents")
    .select("*")
    .eq("payment_id", paymentId)
    .neq("status", "EXPIRED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return null
  return data as PaymentIntent | null
}

export async function markPaymentIntentSelected(input: {
  id: string
  selected_network: string
  payment_id: string
}) {
  const { data, error } = await db
    .from("payment_intents")
    .update({
      selected_network: input.selected_network,
      payment_id: input.payment_id,
      status: "SELECTED",
      updated_at: new Date().toISOString()
    })
    .eq("id", input.id)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to update payment intent: ${error.message}`)
  }

  return data as PaymentIntent
}
