import { assertValidTransition } from "./paymentStateMachine"
import { supabase } from "../database/supabase"

export async function updatePaymentStatus(
  paymentId: string,
  nextStatus: string
) {

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single()

  if (!payment) {
    throw new Error("Payment not found")
  }

  const currentStatus = payment.status

  assertValidTransition(currentStatus, nextStatus)

  await supabase
    .from("payments")
    .update({ status: nextStatus })
    .eq("id", paymentId)

}