import { NextRequest, NextResponse } from "next/server"
import { createSupportTicketMessageForMerchant } from "@/engine/support/createSupportTicketMessage"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

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

    return NextResponse.json({ message }, { status: 201 })
  } catch (error: unknown) {
    const err = apiError(error, "Failed to send message")
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
}
