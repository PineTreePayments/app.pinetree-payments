import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type SupportTicketRecord = {
  id: string
  merchant_id: string
  user_id: string | null
  category: string
  subject: string
  description: string
  priority: string
  status: string
  related_payment_id: string | null
  created_at: string
  updated_at: string
}

export type CreateSupportTicketRecordInput = {
  merchantId: string
  userId?: string | null
  category: string
  subject: string
  description: string
  priority: string
  status: string
  relatedPaymentId?: string | null
}

export async function createSupportTicketRecord(input: CreateSupportTicketRecordInput) {
  const { data, error } = await db
    .from("support_tickets")
    .insert({
      merchant_id: input.merchantId,
      user_id: input.userId ?? null,
      category: input.category,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      status: input.status,
      related_payment_id: input.relatedPaymentId || null
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to create support ticket: ${error.message}`)
  }

  return data as SupportTicketRecord
}

export async function getSupportTicketsForMerchant(merchantId: string) {
  const { data, error } = await db
    .from("support_tickets")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(`Failed to load support tickets: ${error.message}`)
  }

  return (data || []) as SupportTicketRecord[]
}
