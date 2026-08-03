import { NextRequest, NextResponse } from "next/server"
import { getAdminStatusFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getShift4OperatorStatusFromRequest } from "@/lib/api/shift4OperatorAuth"

export async function GET(req: NextRequest) {
  try {
    const status = await getAdminStatusFromRequest(req)
    // A single boolean, decided entirely on the server. The configured operator
    // address is never sent to the browser, so the client can gate rendering
    // without ever comparing an email itself.
    const shift4Operator = (await getShift4OperatorStatusFromRequest(req)).authorized

    return NextResponse.json({
      isAdmin: status.isAdmin,
      merchantId: status.merchantId,
      email: status.isAdmin ? status.email : null,
      role: status.isAdmin ? status.role : null,
      shift4Operator,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
