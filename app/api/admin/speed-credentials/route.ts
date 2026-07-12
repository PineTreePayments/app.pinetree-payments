/**
 * Internal-only. Returns non-secret Speed Custom Connect credential metadata
 * (status, account id, login email, timestamps) for a single merchant -
 * never the password. See app/api/admin/speed-credentials/[merchantId]/reveal
 * for the explicit, audited action that decrypts and returns the password.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getAdminSpeedCredentialSummary } from "@/engine/adminSpeedCredentials"

function message(error: unknown) {
  return error instanceof Error ? error.message : "Speed credential lookup failed"
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const merchantId = req.nextUrl.searchParams.get("merchantId")
    if (!merchantId) {
      return NextResponse.json({ error: "merchantId is required" }, { status: 400 })
    }

    const credential = await getAdminSpeedCredentialSummary(merchantId)
    return NextResponse.json(
      { credential },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: getRouteErrorStatus(error) })
  }
}
