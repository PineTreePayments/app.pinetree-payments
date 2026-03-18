import { supabase } from "@/lib/providers/supabase"

export async function createPaymentRecord(payment: any) {

  const { error } = await supabase
    .from("payments")
    .insert(payment)

  if (error) {
    throw error
  }

}