import { NextRequest, NextResponse } from "next/server"
import { getPosMethodReadinessEngine } from "@/engine/posMethodReadiness"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

export async function GET(req: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(req)

    return NextResponse.json(await getPosMethodReadinessEngine(merchantId))
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
