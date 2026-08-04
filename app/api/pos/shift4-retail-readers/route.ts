import { NextRequest, NextResponse } from "next/server"

import {
  getShift4RetailTerminalSelection,
  listShift4RetailTerminalSelections,
} from "@/engine/shift4/retailTerminal"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

/**
 * Safe Retail reader selection for an authenticated PineTree POS terminal.
 * The terminal-session claim supplies the merchant identity; no request field
 * can select another merchant, provider, terminal identifier, or environment.
 */
export async function GET(request: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(request)
    const readers = await listShift4RetailTerminalSelections(merchantId)
    return NextResponse.json({ readers }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to load Shift4 Retail readers" },
      { status: getRouteErrorStatus(error), headers: { "Cache-Control": "no-store" } }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(request)
    const body = await request.json().catch(() => null) as { readerId?: unknown } | null
    const readerId = typeof body?.readerId === "string" ? body.readerId.trim() : ""
    const reader = await getShift4RetailTerminalSelection(merchantId, readerId)
    if (!reader) return NextResponse.json({ error: "Shift4 Retail reader is unavailable" }, { status: 404 })
    return NextResponse.json({ reader }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to select Shift4 Retail reader" },
      { status: getRouteErrorStatus(error), headers: { "Cache-Control": "no-store" } }
    )
  }
}
