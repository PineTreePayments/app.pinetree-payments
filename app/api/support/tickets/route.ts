import { NextRequest, NextResponse } from "next/server"
import { createSupportTicket } from "@/engine/support/createSupportTicket"
import { getSupportTickets } from "@/engine/support/getSupportTickets"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type TicketBody = {
  category?: string
  subject?: string
  description?: string
  priority?: string
  relatedPaymentId?: string | null
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const tickets = await getSupportTickets({ merchantId })
    return NextResponse.json({ tickets })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load support tickets" },
      { status: getRouteErrorStatus(error) }
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

    return NextResponse.json({ ticket }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create support ticket" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
