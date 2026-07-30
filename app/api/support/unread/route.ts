import { NextRequest, NextResponse } from "next/server"
import { getMerchantSupportUnread } from "@/engine/support/supportUnread"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

/**
 * Unread PineTree Support replies for the authenticated merchant.
 *
 * The merchant is resolved from the verified session token — a client-supplied
 * merchant id is never accepted.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const unread = await getMerchantSupportUnread(merchantId)
    return NextResponse.json(unread)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load unread support messages"
    const storageMissing =
      message.includes("support_tickets") ||
      message.includes("support_ticket_messages") ||
      message.includes("merchant_last_read_at") ||
      message.includes("schema cache") ||
      message.includes("Could not find the table")

    // A missing support table or read-boundary column must not surface as a
    // dashboard error — the badge simply reports zero until the migration runs.
    if (storageMissing) {
      console.error("[support:unread] storage unavailable", { error: message })
      return NextResponse.json({ totalUnread: 0, unreadTicketCount: 0, tickets: [] })
    }

    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(error) })
  }
}
