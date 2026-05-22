import { NextRequest, NextResponse } from "next/server"
import { getDrawerState } from "@/engine/cashDrawer"
import { getDrawerLog } from "@/database/cashDrawer"
import { verifyTerminalSession } from "@/lib/api/terminalAuth"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let terminalId: string

    if (token.startsWith("pts_")) {
      // Terminal device: terminalId is enforced by the session token claims
      let claims
      try {
        claims = verifyTerminalSession(token)
      } catch {
        return NextResponse.json({ error: "Invalid or expired terminal session" }, { status: 401 })
      }
      terminalId = claims.tid
    } else {
      // Merchant dashboard: authenticate the merchant, then read terminalId from query
      await requireMerchantIdFromRequest(req)
      terminalId = String(req.nextUrl.searchParams.get("terminalId") || "").trim()
      if (!terminalId) {
        return NextResponse.json({ error: "Missing terminalId" }, { status: 400 })
      }
    }

    const [state, log] = await Promise.all([
      getDrawerState(terminalId),
      getDrawerLog(terminalId, 20)
    ])

    return NextResponse.json({
      balance: state.balance,
      active: state.active,
      lastEntry: state.lastEntry,
      log
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
