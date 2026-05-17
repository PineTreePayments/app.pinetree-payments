import { NextRequest, NextResponse } from "next/server"
import { openDrawerShift } from "@/engine/cashDrawer"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const body = await req.json()
    const startingAmount = Number(body.startingAmount || 0)

    const entry = await openDrawerShift(terminalId, merchantId, startingAmount)
    return NextResponse.json({ success: true, entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
