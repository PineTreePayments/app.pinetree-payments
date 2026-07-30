import { NextRequest, NextResponse } from "next/server"
import { createSupportTicketMessageForMerchant } from "@/engine/support/createSupportTicketMessage"
import { getSupportTicketByIdForMerchant } from "@/database/supportTickets"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { sendMerchantReplyThreadNotification } from "@/lib/email/sendSupportNotification"

type RouteContext = { params: Promise<{ ticketId: string }> }

function apiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  return { message, status: getRouteErrorStatus(error) }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as { message?: string }

    if (!body.message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const message = await createSupportTicketMessageForMerchant({
      ticketId,
      merchantId,
      message: body.message
    })

    // Staff notification for a merchant follow-up is appended to the ticket's
    // existing mail thread rather than creating a new email per reply. Never
    // blocks or fails the saved message.
    let warning: string | undefined
    try {
      const ticket = await getSupportTicketByIdForMerchant(ticketId, merchantId)
      if (ticket) {
        const notification = await sendMerchantReplyThreadNotification(ticket, message.message)
        warning = notification.warning
      }
    } catch (emailError) {
      console.error("[support:messages] thread notification failed", {
        ticketId,
        error: emailError instanceof Error ? emailError.message : String(emailError)
      })
      warning = "Message saved, but the support notification could not be sent."
    }

    return NextResponse.json({ message, warning }, { status: 201 })
  } catch (error: unknown) {
    const err = apiError(error, "Failed to send message")
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
}
