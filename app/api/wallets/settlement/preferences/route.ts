/**
 * GET  /api/wallets/settlement/preferences  — load merchant settlement preference
 * POST /api/wallets/settlement/preferences  — save merchant settlement preference
 *
 * Only "manual" mode is currently active. end_of_day and auto are coming soon.
 * Resilient: if the preferences table hasn't been migrated yet, returns { mode: "manual" }.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  requireMerchantIdFromRequest,
  getRouteErrorStatus
} from "@/lib/api/merchantAuth"
import {
  getSettlementPreference,
  upsertSettlementPreference,
  type SettlementMode
} from "@/database/settlementPreferences"

const ALLOWED_MODES: SettlementMode[] = ["manual", "end_of_day", "auto"]

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return errorResponse("Unauthorized", getRouteErrorStatus(err))
  }

  const pref = await getSettlementPreference(merchantId)
  return NextResponse.json({ success: true, mode: pref.mode })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch (err) {
    return errorResponse("Unauthorized", getRouteErrorStatus(err))
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse("Invalid request body", 400)
  }

  const mode = String(body.mode || "manual").trim() as SettlementMode
  if (!ALLOWED_MODES.includes(mode)) {
    return errorResponse(`Invalid mode. Must be one of: ${ALLOWED_MODES.join(", ")}`, 400)
  }

  // Only manual is currently selectable — enforce server-side
  if (mode !== "manual") {
    return errorResponse("Only manual settlement mode is available. end_of_day and auto are coming soon.", 422)
  }

  const result = await upsertSettlementPreference(merchantId, mode)
  return NextResponse.json({ success: true, mode: result.mode, saved: result.saved })
}
