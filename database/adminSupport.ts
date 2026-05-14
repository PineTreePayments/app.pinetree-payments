import { supabase, supabaseAdmin } from "./supabase"
import type { SupportTicketRecord, SupportTicketMessageRecord } from "./supportTickets"
import type { MerchantFeedbackRecord } from "./feedback"

const db = supabaseAdmin || supabase

export async function getAllSupportTickets(limit = 200): Promise<SupportTicketRecord[]> {
  const { data, error } = await db
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to load tickets: ${error.message}`)
  return (data || []) as SupportTicketRecord[]
}

export async function getSupportTicketByIdAdmin(
  ticketId: string
): Promise<SupportTicketRecord | null> {
  const { data, error } = await db
    .from("support_tickets")
    .select("*")
    .eq("id", ticketId)
    .single()

  if (error) return null
  return data as SupportTicketRecord
}

export async function getSupportTicketMessagesAdmin(
  ticketId: string
): Promise<SupportTicketMessageRecord[]> {
  const { data, error } = await db
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Failed to load messages: ${error.message}`)
  return (data || []) as SupportTicketMessageRecord[]
}

export async function updateSupportTicketAdmin(
  ticketId: string,
  update: {
    status?: string
    resolved_at?: string | null
    archived_at?: string | null
    last_response_at?: string | null
  }
): Promise<SupportTicketRecord> {
  const { data, error } = await db
    .from("support_tickets")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", ticketId)
    .select("*")
    .single()

  if (error) throw new Error(`Failed to update ticket: ${error.message}`)
  return data as SupportTicketRecord
}

export async function createAdminTicketMessageRecord(input: {
  ticketId: string
  merchantId: string
  message: string
}): Promise<SupportTicketMessageRecord> {
  const { data, error } = await db
    .from("support_ticket_messages")
    .insert({
      ticket_id: input.ticketId,
      merchant_id: input.merchantId,
      sender_type: "pinetree",
      sender_name: "PineTree Support",
      sender_email: null,
      message: input.message
    })
    .select("*")
    .single()

  if (error) throw new Error(`Failed to create admin reply: ${error.message}`)
  return data as SupportTicketMessageRecord
}

export async function getAllFeedback(limit = 200): Promise<MerchantFeedbackRecord[]> {
  const { data, error } = await db
    .from("merchant_feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to load feedback: ${error.message}`)
  return (data || []) as MerchantFeedbackRecord[]
}
