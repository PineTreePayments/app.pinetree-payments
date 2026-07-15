import { NextRequest, NextResponse } from "next/server"
import { getAdminStatusFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"

export async function GET(req: NextRequest) {
  try {
    const status = await getAdminStatusFromRequest(req)

    return NextResponse.json({
      isAdmin: status.isAdmin,
      merchantId: status.merchantId,
      email: status.isAdmin ? status.email : null,
      role: status.isAdmin ? status.role : null,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
