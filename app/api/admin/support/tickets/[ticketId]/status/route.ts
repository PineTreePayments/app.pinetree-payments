import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { updateSupportTicketStatusForAdmin } from "@/engine/support/adminSupport"

type RouteContext = { params: Promise<{ ticketId: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    await requireAdminFromRequest(req)

    const body = (await req.json()) as { status?: string }

    if (!body.status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 })
    }

    const ticket = await updateSupportTicketStatusForAdmin(ticketId, body.status)
    return NextResponse.json({ ticket })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update status" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
