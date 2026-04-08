import { supabase } from "./supabase"

export type PaymentEventType = 
  | "payment.created"
  | "payment.pending"
  | "payment.processing"
  | "payment.confirmed"
  | "payment.failed"
  | "payment.cancelled"
  | "payment.expired"
  | "payment.refunded"

export type PaymentEvent = {
  id: string
  payment_id: string
  event_type: PaymentEventType
  provider_event?: string
  raw_payload?: any
  created_at: string
}

export type CreatePaymentEventInput = {
  id: string
  payment_id: string
  event_type: PaymentEventType
  provider_event?: string
  raw_payload?: any
}

/**
 * Create a new payment event record
 */
export async function createPaymentEvent(input: CreatePaymentEventInput) {
  const { data, error } = await supabase
    .from("payment_events")
    .insert({
      id: input.id,
      payment_id: input.payment_id,
      event_type: input.event_type,
      provider_event: input.provider_event,
      raw_payload: input.raw_payload
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create payment event: ${error.message}`)
  }

  return data as PaymentEvent
}

/**
 * Get events for a payment
 */
export async function getPaymentEvents(paymentId: string) {
  const { data, error } = await supabase
    .from("payment_events")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch payment events: ${error.message}`)
  }

  return data as PaymentEvent[]
}

/**
 * Get the latest event for a payment
 */
export async function getLatestPaymentEvent(paymentId: string) {
  const { data, error } = await supabase
    .from("payment_events")
    .select("*")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  if (error) {
    return null
  }

  return data as PaymentEvent | null
}

/**
 * Get events by type
 */
export async function getEventsByType(
  eventType: PaymentEventType,
  limit: number = 50
) {
  const { data, error } = await supabase
    .from("payment_events")
    .select(`
      *,
      payments (
        merchant_id
      )
    `)
    .eq("event_type", eventType)
    .limit(limit)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch events: ${error.message}`)
  }

  return data as (PaymentEvent & { payments?: any })[]
}