import { supabase } from "@/lib/database/supabase"

type PaymentEventInput = {
  paymentId: string
  provider: string
  eventType: string
  payload: any
}

export async function recordPaymentEvent({
  paymentId,
  provider,
  eventType,
  payload
}: PaymentEventInput) {

  const { error } = await supabase
    .from("payment_events")
    .insert([
      {
        payment_id: paymentId,
        provider: provider,
        event_type: eventType,
        payload: payload,
        created_at: new Date().toISOString()
      }
    ])

  if (error) {
    console.error("Failed to record payment event:", error)
  }

}