import {
  getSupportTicketByIdForMerchant,
  getSupportTicketMessagesForMerchant,
  type SupportTicketRecord,
  type SupportTicketMessageRecord
} from "@/database/supportTickets"

export type SupportTicketDetail = {
  ticket: SupportTicketRecord
  messages: SupportTicketMessageRecord[]
}

export async function getSupportTicketDetail(
  ticketId: string,
  merchantId: string
): Promise<SupportTicketDetail | null> {
  const ticket = await getSupportTicketByIdForMerchant(ticketId, merchantId)
  if (!ticket) return null

  const messages = await getSupportTicketMessagesForMerchant(ticketId, merchantId)
  return { ticket, messages }
}
