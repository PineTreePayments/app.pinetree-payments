/**
 * Merchant unread support-message state.
 *
 * A support message counts as unread for a merchant when it was sent by
 * PineTree Support (`sender_type = 'pinetree'`) and its `created_at` is strictly
 * newer than the ticket's `merchant_last_read_at` boundary. Merchant replies,
 * 'system' entries, and ticket status changes never produce unread counts —
 * status transitions do not write support messages.
 *
 * Read state advances only through a message id the merchant actually viewed, so
 * a reply that lands while the thread is open stays unread.
 */

import {
  getSupportMessagesFromSupportForMerchant,
  getSupportTicketByIdForMerchant,
  getSupportTicketMessageForMerchant,
  getSupportTicketReadBoundariesForMerchant,
  updateSupportTicketMerchantReadBoundary,
  type SupportTicketReadBoundaryRecord,
  type SupportUnreadMessageRecord,
} from "@/database/supportTickets"

type StatusError = Error & { status?: number }

function statusError(message: string, status: number): StatusError {
  const error: StatusError = new Error(message)
  error.status = status
  return error
}

export type SupportTicketUnread = {
  ticketId: string
  unreadCount: number
  latestUnreadAt: string | null
}

export type MerchantSupportUnread = {
  totalUnread: number
  unreadTicketCount: number
  tickets: SupportTicketUnread[]
}

function toTime(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

/**
 * Pure unread projection. Kept separate from IO so the boundary rules are
 * directly testable.
 */
export function computeSupportUnread(
  supportMessages: SupportUnreadMessageRecord[],
  readBoundaries: SupportTicketReadBoundaryRecord[]
): MerchantSupportUnread {
  const boundaries = new Map(
    readBoundaries.map((ticket) => [ticket.id, toTime(ticket.merchant_last_read_at)])
  )

  const perTicket = new Map<string, SupportTicketUnread>()

  for (const message of supportMessages) {
    // A message whose ticket is outside this merchant's ticket set is ignored
    // rather than counted against an unknown boundary.
    if (!boundaries.has(message.ticket_id)) continue

    const boundary = boundaries.get(message.ticket_id) ?? Number.NEGATIVE_INFINITY
    if (toTime(message.created_at) <= boundary) continue

    const existing = perTicket.get(message.ticket_id)
    if (existing) {
      existing.unreadCount += 1
      if (toTime(message.created_at) > toTime(existing.latestUnreadAt)) {
        existing.latestUnreadAt = message.created_at
      }
    } else {
      perTicket.set(message.ticket_id, {
        ticketId: message.ticket_id,
        unreadCount: 1,
        latestUnreadAt: message.created_at,
      })
    }
  }

  const tickets = Array.from(perTicket.values()).sort(
    (a, b) => toTime(b.latestUnreadAt) - toTime(a.latestUnreadAt)
  )

  return {
    totalUnread: tickets.reduce((sum, ticket) => sum + ticket.unreadCount, 0),
    unreadTicketCount: tickets.length,
    tickets,
  }
}

export async function getMerchantSupportUnread(
  merchantId: string
): Promise<MerchantSupportUnread> {
  const id = String(merchantId || "").trim()
  if (!id) throw statusError("merchantId is required", 400)

  const [readBoundaries, supportMessages] = await Promise.all([
    getSupportTicketReadBoundariesForMerchant(id),
    getSupportMessagesFromSupportForMerchant(id),
  ])

  return computeSupportUnread(supportMessages, readBoundaries)
}

export type MarkSupportTicketReadResult = {
  ticketId: string
  readAt: string | null
  advanced: boolean
}

/**
 * Marks support replies up to `lastMessageId` as read for this merchant.
 *
 * The boundary is resolved from the viewed message's own timestamp — never from
 * "now" — so a reply created after the merchant's view remains unread. The
 * boundary only ever moves forward.
 */
export async function markSupportTicketRead(input: {
  merchantId: string
  ticketId: string
  lastMessageId?: string | null
}): Promise<MarkSupportTicketReadResult> {
  const merchantId = String(input.merchantId || "").trim()
  const ticketId = String(input.ticketId || "").trim()
  if (!merchantId) throw statusError("merchantId is required", 400)
  if (!ticketId) throw statusError("ticketId is required", 400)

  const ticket = await getSupportTicketByIdForMerchant(ticketId, merchantId)
  if (!ticket) throw statusError("Ticket not found", 404)

  const lastMessageId = String(input.lastMessageId || "").trim()
  if (!lastMessageId) {
    // Nothing was viewed that could be marked read (thread has no support
    // replies yet). Leaving the boundary untouched keeps future replies unread.
    return {
      ticketId,
      readAt: ticket.merchant_last_read_at ?? null,
      advanced: false,
    }
  }

  const message = await getSupportTicketMessageForMerchant(lastMessageId, ticketId, merchantId)
  if (!message) throw statusError("Message not found", 404)

  const currentBoundary = toTime(ticket.merchant_last_read_at)
  if (toTime(message.created_at) <= currentBoundary) {
    return {
      ticketId,
      readAt: ticket.merchant_last_read_at ?? null,
      advanced: false,
    }
  }

  const updated = await updateSupportTicketMerchantReadBoundary(
    ticketId,
    merchantId,
    message.created_at
  )

  return {
    ticketId,
    readAt: updated.merchant_last_read_at ?? message.created_at,
    advanced: true,
  }
}
