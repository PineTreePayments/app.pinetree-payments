import { NextRequest, NextResponse } from "next/server"
import { getPosTerminalDisplayEngine } from "@/engine/posTerminalSession"
import { resetPosTerminalPinWithRecoveryEngine } from "@/engine/posTerminals"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/**
 * GET — returns safe terminal display info (name, drawer state, provider).
 * Never returns the terminal PIN or a session token. PIN verification and
 * session-token issuance happen via POST /api/pos/terminal-auth.
 */
export async function GET(req: NextRequest) {
  try {
    const terminalId = req.nextUrl.searchParams.get("tid") || ""

    if (!terminalId) {
      return NextResponse.json({ error: "Missing terminal id" }, { status: 400 })
    }

    const data = await getPosTerminalDisplayEngine(terminalId)
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load terminal session") },
      { status: 500 }
    )
  }
}

/**
 * POST — PIN recovery: reset the terminal PIN using the recovery phrase.
 * Does NOT verify a login PIN or issue a session token.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      terminalId?: string
      recoveryPhrase?: string
      newPin?: string
    }

    if (!body.terminalId) {
      return NextResponse.json({ error: "Missing terminal id" }, { status: 400 })
    }

    if (!body.recoveryPhrase?.trim()) {
      return NextResponse.json({ error: "Missing recovery phrase" }, { status: 400 })
    }

    if (!body.newPin || body.newPin.length !== 4) {
      return NextResponse.json({ error: "New PIN must be 4 digits" }, { status: 400 })
    }

    await resetPosTerminalPinWithRecoveryEngine(
      body.terminalId,
      body.recoveryPhrase.trim(),
      body.newPin
    )

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to reset terminal PIN") },
      { status: 500 }
    )
  }
}
