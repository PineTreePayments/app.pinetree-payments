import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { createAdminTicketReply } from "@/engine/support/adminSupport"
import { sendAdminReplyNotification } from "@/lib/email/sendAdminReplyNotification"

type RouteContext = { params: Promise<{ ticketId: string }> }

type ReplyBody = {
  message?: string
  status?: string
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { ticketId } = await context.params
    await requireAdminFromRequest(req)

    const body = (await req.json()) as ReplyBody

    if (!body.message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const result = await createAdminTicketReply(
      ticketId,
      body.message,
      body.status ?? "waiting_on_merchant"
    )

    let warning: string | undefined
    try {
      const emailResult = await sendAdminReplyNotification(result.ticket, body.message)
      if (!emailResult.sent) warning = emailResult.warning
    } catch (emailError) {
      console.error("[admin:reply] email notification failed", {
        ticketId,
        error: emailError instanceof Error ? emailError.message : String(emailError),
      })
      warning = "Reply saved but email notification failed."
    }

    return NextResponse.json({ ...result, warning }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send reply" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
