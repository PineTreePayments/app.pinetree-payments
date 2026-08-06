import { NextRequest, NextResponse } from "next/server"
import { getPosTerminalBootstrapEngine } from "@/engine/posTerminalSession"
import { resetPosTerminalPinWithRecoveryEngine } from "@/engine/posTerminals"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    return Number((error as { status?: number }).status) || 500
  }
  return 500
}

/**
 * GET - unauthenticated bootstrap for the terminal/PIN screen.
 *
 * Returns display data only: terminal name and id, autolock, drawer-shift
 * state, starting cash configuration, and the rail label. It issues NO
 * credential — no terminal session token, no PIN, no recovery phrase, no
 * merchant binding, no provider secret.
 *
 * A terminal session is obtained solely from `POST /api/pos/terminal-auth`
 * after the PIN is verified server-side. This route previously returned a
 * signed 24-hour `pts_` token to any caller holding a terminal id, which
 * bypassed the PIN gate entirely (audit finding RA-1).
 */
export async function GET(req: NextRequest) {
  try {
    const terminalId = req.nextUrl.searchParams.get("tid") || ""

    if (!terminalId) {
      return NextResponse.json({ error: "Missing terminal id" }, { status: 400 })
    }

    const data = await getPosTerminalBootstrapEngine(terminalId)
    return NextResponse.json(
      { success: true, ...data },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load terminal session") },
      { status: getErrorStatus(error) }
    )
  }
}

/**
 * POST - PIN recovery: reset the terminal PIN using the recovery phrase.
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
      { status: getErrorStatus(error) }
    )
  }
}
