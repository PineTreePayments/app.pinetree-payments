import { NextRequest, NextResponse } from "next/server"
import { previewPosBreakdownEngine } from "@/engine/posPayments"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const amount = Number(req.nextUrl.searchParams.get("amount") || 0)
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
    }

    const breakdown = await previewPosBreakdownEngine(merchantId, terminalId, amount)
    return NextResponse.json(breakdown)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
