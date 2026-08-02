import { supabaseAdmin } from "./supabase"

export type Shift4TenderGroupRow = {
  id: string
  merchant_id: string
  payment_id: string
  merchant_provider_connection_id: string
  currency: string
  requested_amount_minor: number
  state: "open" | "settled" | "closed" | "reconciliation_required"
  created_at: string
  updated_at: string
}

export async function getShift4TenderGroup(merchantId: string, paymentId: string): Promise<Shift4TenderGroupRow | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Shift4 tender reads require service-role database access")
  const { data, error } = await supabaseAdmin.from("shift4_tender_groups")
    .select("id, merchant_id, payment_id, merchant_provider_connection_id, currency, requested_amount_minor, state, created_at, updated_at")
    .eq("merchant_id", merchantId).eq("payment_id", paymentId).maybeSingle()
  if (error) throw new Error(`Failed to load Shift4 tender group: ${error.message}`)
  return (data ?? null) as Shift4TenderGroupRow | null
}
