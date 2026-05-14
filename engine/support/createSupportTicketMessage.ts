import {
  createSupportTicketMessage as createMessage,
  getSupportTicketByIdForMerchant,
  type SupportTicketMessageRecord
} from "@/database/supportTickets"

type StatusError = Error & { status?: number }

function statusError(message: string, status: number): StatusError {
  const error: StatusError = new Error(message)
  error.status = status
  return error
}

const OPEN_STATUSES = ["open", "in_review", "waiting_on_merchant"]

export async function createSupportTicketMessageForMerchant(input: {
  ticketId: string
  merchantId: string
  message: string
}): Promise<SupportTicketMessageRecord> {
  const ticket = await getSupportTicketByIdForMerchant(input.ticketId, input.merchantId)
  if (!ticket) {
    throw statusError("Ticket not found", 404)
  }

  if (!OPEN_STATUSES.includes(ticket.status)) {
    throw statusError("Cannot reply to a resolved or archived ticket", 400)
  }

  const message = String(input.message || "").trim().slice(0, 5000)
  if (!message) {
    throw statusError("message is required", 400)
  }

  return createMessage({
    ticketId: input.ticketId,
    merchantId: input.merchantId,
    senderType: "merchant",
    message
  })
}
