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
  resolved_at: string | null
  archived_at: string | null
  last_response_at: string | null
  merchant_email: string | null
  merchant_business_name: string | null
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
  merchantEmail?: string | null
  merchantBusinessName?: string | null
}

export type SupportTicketMessageRecord = {
  id: string
  ticket_id: string
  merchant_id: string
  sender_type: "merchant" | "pinetree" | "system"
  sender_name: string | null
  sender_email: string | null
  message: string
  created_at: string
}

export type CreateSupportTicketMessageInput = {
  ticketId: string
  merchantId: string
  senderType: "merchant" | "pinetree" | "system"
  senderName?: string | null
  senderEmail?: string | null
  message: string
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
      related_payment_id: input.relatedPaymentId || null,
      merchant_email: input.merchantEmail ?? null,
      merchant_business_name: input.merchantBusinessName ?? null
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

export async function getSupportTicketByIdForMerchant(
  ticketId: string,
  merchantId: string
): Promise<SupportTicketRecord | null> {
  const { data, error } = await db
    .from("support_tickets")
    .select("*")
    .eq("id", ticketId)
    .eq("merchant_id", merchantId)
    .single()

  if (error) return null
  return data as SupportTicketRecord
}

export async function getSupportTicketMessagesForMerchant(
  ticketId: string,
  merchantId: string
): Promise<SupportTicketMessageRecord[]> {
  const { data, error } = await db
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(`Failed to load ticket messages: ${error.message}`)
  }

  return (data || []) as SupportTicketMessageRecord[]
}

export async function createSupportTicketMessage(
  input: CreateSupportTicketMessageInput
): Promise<SupportTicketMessageRecord> {
  const { data, error } = await db
    .from("support_ticket_messages")
    .insert({
      ticket_id: input.ticketId,
      merchant_id: input.merchantId,
      sender_type: input.senderType,
      sender_name: input.senderName ?? null,
      sender_email: input.senderEmail ?? null,
      message: input.message
    })
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to create ticket message: ${error.message}`)
  }

  return data as SupportTicketMessageRecord
}

export async function updateSupportTicketStatus(
  ticketId: string,
  merchantId: string,
  status: string,
  extra?: {
    resolved_at?: string | null
    archived_at?: string | null
    last_response_at?: string | null
  }
): Promise<SupportTicketRecord> {
  const { data, error } = await db
    .from("support_tickets")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...extra
    })
    .eq("id", ticketId)
    .eq("merchant_id", merchantId)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to update ticket status: ${error.message}`)
  }

  return data as SupportTicketRecord
}
