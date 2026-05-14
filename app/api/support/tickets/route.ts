import { NextRequest, NextResponse } from "next/server"
import { createSupportTicket } from "@/engine/support/createSupportTicket"
import { getSupportTickets } from "@/engine/support/getSupportTickets"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { sendSupportTicketNotification } from "@/lib/email/sendSupportNotification"

type TicketBody = {
  category?: string
  subject?: string
  description?: string
  priority?: string
  relatedPaymentId?: string | null
}

function getSupportApiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  const missingStorage =
    message.includes("support_tickets") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table")

  if (missingStorage) {
    console.error("[support:tickets] storage unavailable", { error: message })
    return {
      message: "Support storage is not enabled yet. Apply the Help Center database migration to view and create tickets.",
      status: 503
    }
  }

  return {
    message,
    status: getRouteErrorStatus(error)
  }
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const tickets = await getSupportTickets({ merchantId })
    return NextResponse.json({ tickets })
  } catch (error: unknown) {
    const apiError = getSupportApiError(error, "Failed to load support tickets")
    return NextResponse.json(
      { error: apiError.message },
      { status: apiError.status }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as TicketBody

    if (!body.subject || !body.description || !body.category) {
      return NextResponse.json(
        { error: "category, subject, and description are required" },
        { status: 400 }
      )
    }

    const ticket = await createSupportTicket({
      merchantId,
      category: body.category,
      subject: body.subject,
      description: body.description,
      priority: body.priority,
      relatedPaymentId: body.relatedPaymentId
    })

    let warning: string | undefined
    try {
      const notification = await sendSupportTicketNotification(ticket)
      warning = notification.warning
    } catch (emailError) {
      console.error("[support:tickets] email notification failed", {
        ticketId: ticket.id,
        error: emailError instanceof Error ? emailError.message : String(emailError)
      })
      warning = "Saved, but email notification failed."
    }

    return NextResponse.json({ ticket, warning }, { status: 201 })
  } catch (error: unknown) {
    const apiError = getSupportApiError(error, "Failed to create support ticket")
    return NextResponse.json(
      { error: apiError.message },
      { status: apiError.status }
    )
  }
}
