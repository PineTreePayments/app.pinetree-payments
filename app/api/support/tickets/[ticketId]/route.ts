import { NextRequest, NextResponse } from "next/server"
import { getSupportTicketDetail } from "@/engine/support/getSupportTicketDetail"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

type RouteContext = { params: Promise<{ ticketId: string }> }

function apiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  return { message, status: getRouteErrorStatus(error) }
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    const merchantId = await requireMerchantIdFromRequest(req)
    const detail = await getSupportTicketDetail(ticketId, merchantId)

    if (!detail) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    return NextResponse.json(detail)
  } catch (error: unknown) {
    const err = apiError(error, "Failed to load ticket")
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
}
