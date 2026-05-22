import { NextRequest, NextResponse } from "next/server"
import { verifyPosTerminalPinEngine } from "@/engine/posTerminalSession"

/**
 * POST /api/pos/terminal-auth
 *
 * Verifies the entered PIN server-side and issues a terminal session token only
 * on success. This is the only route that produces a terminal session token;
 * the GET /api/pos/terminal-session route intentionally never returns one.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      terminalId?: string
      pin?: string
    }

    const terminalId = String(body.terminalId || "").trim()
    const pin = String(body.pin || "").trim()

    if (!terminalId) {
      return NextResponse.json({ error: "Missing terminalId" }, { status: 400 })
    }

    if (!pin || pin.length !== 4) {
      return NextResponse.json({ error: "PIN must be 4 digits" }, { status: 400 })
    }

    const sessionToken = await verifyPosTerminalPinEngine(terminalId, pin)

    return NextResponse.json({ sessionToken })
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: number }).status) || 500
        : 500
    const message = error instanceof Error ? error.message : "PIN verification failed"
    return NextResponse.json({ error: message }, { status })
  }
}
