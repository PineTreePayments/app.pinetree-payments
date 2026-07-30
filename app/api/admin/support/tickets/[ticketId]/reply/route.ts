import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { createAdminTicketReply } from "@/engine/support/adminSupport"

/**
 * PineTree Support replies are in-app only.
 *
 * No outbound email is sent here — not Resend, not SMTP. The reply is persisted,
 * the ticket timestamps advance, and the merchant learns about it through the
 * Help Center unread badge (GET /api/support/unread). Outbound support email is
 * limited to one notification when a ticket is first created, plus merchant
 * follow-ups appended to that same thread.
 */

type RouteContext = { params: Promise<{ ticketId: string }> }

type ReplyBody = {
  message?: string
  status?: string
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    const adminActorId = await requireAdminFromRequest(req)

    const body = (await req.json()) as ReplyBody

    if (!body.message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const result = await createAdminTicketReply(
      ticketId,
      body.message,
      body.status ?? "waiting_on_merchant",
      adminActorId
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send reply" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
