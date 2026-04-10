import { NextRequest, NextResponse } from "next/server"
import { getPosTerminalSessionEngine } from "@/engine/posTerminalSession"
import { resetPosTerminalPinWithRecoveryEngine } from "@/engine/posTerminals"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const terminalId = req.nextUrl.searchParams.get("tid") || ""

    if (!terminalId) {
      return NextResponse.json({ error: "Missing terminal id" }, { status: 400 })
    }

    const data = await getPosTerminalSessionEngine(terminalId)
    return NextResponse.json({ success: true, ...data })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load terminal session") },
      { status: 500 }
    )
  }
}

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
