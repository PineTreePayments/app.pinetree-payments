import {
  getAllSupportTickets,
  getSupportTicketByIdAdmin,
  getSupportTicketMessagesAdmin,
  updateSupportTicketAdmin,
  createAdminTicketMessageRecord,
  getAllFeedback,
} from "@/database/adminSupport"
import type { SupportTicketRecord, SupportTicketMessageRecord } from "@/database/supportTickets"
import type { MerchantFeedbackRecord } from "@/database/feedback"

const VALID_STATUSES = ["open", "in_review", "waiting_on_merchant", "resolved", "archived"]

function statusError(message: string, code: number): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = code
  return error
}

export async function getAllSupportTicketsForAdmin(): Promise<SupportTicketRecord[]> {
  return getAllSupportTickets()
}

export async function getSupportTicketDetailForAdmin(ticketId: string): Promise<{
  ticket: SupportTicketRecord
  messages: SupportTicketMessageRecord[]
} | null> {
  const ticket = await getSupportTicketByIdAdmin(ticketId)
  if (!ticket) return null
  const messages = await getSupportTicketMessagesAdmin(ticketId)
  return { ticket, messages }
}

export async function createAdminTicketReply(
  ticketId: string,
  message: string,
  newStatus: string
): Promise<{
  ticket: SupportTicketRecord
  message: SupportTicketMessageRecord
}> {
  const trimmed = message.trim().slice(0, 10000)
  if (!trimmed) throw statusError("Reply message is required", 400)

  const ticket = await getSupportTicketByIdAdmin(ticketId)
  if (!ticket) throw statusError("Ticket not found", 404)

  const targetStatus = VALID_STATUSES.includes(newStatus) ? newStatus : "waiting_on_merchant"
  const now = new Date().toISOString()

  const updates: Parameters<typeof updateSupportTicketAdmin>[1] = {
    status: targetStatus,
    last_response_at: now,
  }
  if (targetStatus === "resolved" && !ticket.resolved_at) updates.resolved_at = now
  if (targetStatus === "archived" && !ticket.archived_at) updates.archived_at = now

  const [updatedTicket, replyMessage] = await Promise.all([
    updateSupportTicketAdmin(ticketId, updates),
    createAdminTicketMessageRecord({
      ticketId,
      merchantId: ticket.merchant_id,
      message: trimmed,
    }),
  ])

  return { ticket: updatedTicket, message: replyMessage }
}

export async function updateSupportTicketStatusForAdmin(
  ticketId: string,
  status: string
): Promise<SupportTicketRecord> {
  if (!VALID_STATUSES.includes(status)) throw statusError(`Invalid status: ${status}`, 400)

  const ticket = await getSupportTicketByIdAdmin(ticketId)
  if (!ticket) throw statusError("Ticket not found", 404)

  const now = new Date().toISOString()
  const updates: Parameters<typeof updateSupportTicketAdmin>[1] = { status }
  if (status === "resolved" && !ticket.resolved_at) updates.resolved_at = now
  if (status === "archived" && !ticket.archived_at) updates.archived_at = now

  return updateSupportTicketAdmin(ticketId, updates)
}

export async function getAllFeedbackForAdmin(): Promise<MerchantFeedbackRecord[]> {
  return getAllFeedback()
}
