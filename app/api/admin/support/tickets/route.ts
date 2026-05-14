import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAllSupportTicketsForAdmin } from "@/engine/support/adminSupport"

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    const tickets = await getAllSupportTicketsForAdmin()
    return NextResponse.json({ tickets })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tickets" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
