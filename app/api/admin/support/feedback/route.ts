import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAllFeedbackForAdmin } from "@/engine/support/adminSupport"

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    const feedback = await getAllFeedbackForAdmin()
    return NextResponse.json({ feedback })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load feedback" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
