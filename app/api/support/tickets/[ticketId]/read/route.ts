import { NextRequest, NextResponse } from "next/server"
import {
  getMerchantSupportUnread,
  markSupportTicketRead
} from "@/engine/support/supportUnread"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type RouteContext = { params: Promise<{ ticketId: string }> }

/**
 * Marks PineTree Support replies in one ticket as read for the authenticated
 * merchant.
 *
 * `lastMessageId` is the newest support message the merchant actually viewed.
 * The engine resolves the read boundary from that message's timestamp, so a
 * reply that arrives while the thread is open stays unread. Ticket ownership is
 * verified against the session-resolved merchant id.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as { lastMessageId?: string | null }

    const result = await markSupportTicketRead({
      merchantId,
      ticketId,
      lastMessageId: body.lastMessageId ?? null
    })

    const unread = await getMerchantSupportUnread(merchantId)

    return NextResponse.json({ ...result, unread })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update read state"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
