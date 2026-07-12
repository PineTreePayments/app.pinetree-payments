/**
 * Internal-only. Decrypts and returns a merchant's retained Speed Custom
 * Connect login password for an authorized PineTree administrator.
 *
 * - Requires requireAdminFromRequest (authenticated PineTree admin).
 * - Requires an explicit { confirm: true } body - no implicit reveal.
 * - Audits the reveal (merchant_id, account id, environment - never the
 *   password) via insertMerchantAuditEvent.
 * - Cache-Control: no-store so the response is never cached anywhere.
 * - Never call this from a merchant-facing route or frontend.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { revealAdminSpeedCredential } from "@/engine/adminSpeedCredentials"

type RouteContext = { params: Promise<{ merchantId: string }> }

function message(error: unknown) {
  return error instanceof Error ? error.message : "Speed credential reveal failed"
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { merchantId } = await context.params
    const adminId = await requireAdminFromRequest(req)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (body.confirm !== true) {
      return NextResponse.json(
        { error: "Explicit confirm:true is required to reveal a Speed credential." },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    if (!merchantId) {
      return NextResponse.json(
        { error: "merchantId is required" },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const credential = await revealAdminSpeedCredential({ merchantId, adminId })
    return NextResponse.json({ credential }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json(
      { error: message(error) },
      { status: getRouteErrorStatus(error), headers: NO_STORE_HEADERS }
    )
  }
}
