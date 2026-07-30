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
  /**
   * Newest support message this merchant has viewed. Null until the merchant
   * opens a thread containing a PineTree Support reply. See
   * database/migrations/20260730_add_support_ticket_merchant_read_boundary.sql.
   */
  merchant_last_read_at?: string | null
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

// ─── Merchant unread support messages ────────────────────────────────────────

export type SupportTicketReadBoundaryRecord = {
  id: string
  merchant_last_read_at: string | null
}

export type SupportUnreadMessageRecord = {
  id: string
  ticket_id: string
  created_at: string
}

/**
 * Per-ticket read boundaries for one merchant. Mirrors the ticket-list bound so
 * the badge and the Help Center list describe the same set of tickets.
 */
export async function getSupportTicketReadBoundariesForMerchant(
  merchantId: string
): Promise<SupportTicketReadBoundaryRecord[]> {
  const { data, error } = await db
    .from("support_tickets")
    .select("id, merchant_last_read_at")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(`Failed to load support read state: ${error.message}`)
  }

  return (data || []) as SupportTicketReadBoundaryRecord[]
}

/**
 * Visible PineTree Support messages for one merchant, newest first.
 *
 * Only `sender_type = 'pinetree'` rows are returned — merchant replies and
 * 'system' entries must never produce a merchant notification.
 */
export async function getSupportMessagesFromSupportForMerchant(
  merchantId: string,
  limit = 500
): Promise<SupportUnreadMessageRecord[]> {
  const { data, error } = await db
    .from("support_ticket_messages")
    .select("id, ticket_id, created_at")
    .eq("merchant_id", merchantId)
    .eq("sender_type", "pinetree")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load support messages: ${error.message}`)
  }

  return (data || []) as SupportUnreadMessageRecord[]
}

/**
 * Single message scoped to both ticket and merchant. Used to resolve the read
 * boundary from the message id the merchant actually viewed, so a reply that
 * arrives while the thread is open is not marked read.
 */
export async function getSupportTicketMessageForMerchant(
  messageId: string,
  ticketId: string,
  merchantId: string
): Promise<SupportTicketMessageRecord | null> {
  const { data, error } = await db
    .from("support_ticket_messages")
    .select("*")
    .eq("id", messageId)
    .eq("ticket_id", ticketId)
    .eq("merchant_id", merchantId)
    .single()

  if (error) return null
  return data as SupportTicketMessageRecord
}

/**
 * Advances the merchant read boundary. The merchant_id predicate keeps one
 * merchant from clearing another merchant's unread state even if a ticket id
 * leaks; the caller only ever advances the boundary forward.
 */
export async function updateSupportTicketMerchantReadBoundary(
  ticketId: string,
  merchantId: string,
  readAt: string
): Promise<SupportTicketRecord> {
  const { data, error } = await db
    .from("support_tickets")
    .update({ merchant_last_read_at: readAt })
    .eq("id", ticketId)
    .eq("merchant_id", merchantId)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Failed to update support read state: ${error.message}`)
  }

  return data as SupportTicketRecord
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
