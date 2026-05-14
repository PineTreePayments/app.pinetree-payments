import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getSupportTicketDetailForAdmin } from "@/engine/support/adminSupport"

type RouteContext = { params: Promise<{ ticketId: string }> }

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    await requireAdminFromRequest(req)
    const detail = await getSupportTicketDetailForAdmin(ticketId)
    if (!detail) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load ticket" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
