import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type MerchantReportPaymentRow = {
  id: string
  merchant_amount?: number | null
  pinetree_fee?: number | null
  gross_amount?: number | null
  currency?: string | null
  created_at: string
  transactions?: Array<{
    status?: string | null
    provider?: string | null
    network?: string | null
    channel?: string | null
  }> | null
}

export async function getMerchantPaymentsForReport(input: {
  merchantId: string
  startDate: string
  endDate: string
}) {
  const merchantId = String(input.merchantId || "").trim()
  const startDate = String(input.startDate || "").trim()
  const endDate = String(input.endDate || "").trim()

  if (!merchantId || !startDate || !endDate) {
    throw new Error("Missing required report filters")
  }

  const { data, error } = await db
    .from("payments")
    .select(`
      id,
      merchant_amount,
      pinetree_fee,
      gross_amount,
      currency,
      created_at,
      transactions (
        status,
        provider,
        network,
        channel
      )
    `)
    .eq("merchant_id", merchantId)
    .gte("created_at", startDate)
    .lte("created_at", endDate)

  if (error) {
    throw new Error(`Failed to load report payments: ${error.message}`)
  }

  return (data || []) as MerchantReportPaymentRow[]
}
