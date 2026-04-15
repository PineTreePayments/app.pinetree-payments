import { NextRequest, NextResponse } from "next/server"
import { getDrawerState } from "@/engine/cashDrawer"
import { getDrawerLog } from "@/database/cashDrawer"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const terminalId = String(searchParams.get("terminalId") || "").trim()

    if (!terminalId) {
      return NextResponse.json({ error: "Missing terminalId" }, { status: 400 })
    }

    const [state, log] = await Promise.all([
      getDrawerState(terminalId),
      getDrawerLog(terminalId, 20)
    ])

    return NextResponse.json({
      balance: state.balance,
      lastEntry: state.lastEntry,
      log
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
