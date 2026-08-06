import { NextRequest, NextResponse } from "next/server"
import { launchPosTerminalEngine } from "@/engine/posTerminalSession"
import { resetPosTerminalPinWithRecoveryEngine } from "@/engine/posTerminals"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const

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
 * GET - authenticated terminal launch.
 *
 * Requires a verified merchant session (the `/terminal` page itself is
 * proxy-protected, so the cashier's browser already holds one). The merchant id
 * is taken from that verified session — never from the query string or body —
 * and the Engine refuses to open a terminal owned by another merchant.
 *
 * On success this returns the terminal's display data **and** its scoped `pts_`
 * session credential, so launching a configured terminal opens the POS
 * immediately. The PIN is not an entry gate; it guards leaving the terminal via
 * `POST /api/pos/terminal-exit-auth`.
 *
 * Audit finding RA-1 was that this route signed a token for anyone who knew a
 * terminal id. What closes it is the verified merchant session plus the
 * server-side ownership check, not a PIN prompt: terminal id possession alone
 * mints nothing.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const terminalId = req.nextUrl.searchParams.get("tid") || ""

    if (!terminalId) {
      return NextResponse.json(
        { error: "Missing terminal id" },
        { status: 400, headers: PRIVATE_NO_STORE }
      )
    }

    const data = await launchPosTerminalEngine({ merchantId, terminalId })
    return NextResponse.json({ success: true, ...data }, { headers: PRIVATE_NO_STORE })
  } catch (error: unknown) {
    // Missing or invalid merchant auth surfaces as 401 from the auth helper;
    // a foreign or unknown terminal surfaces as 404 from the Engine. Neither
    // path returns a credential.
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load terminal session") },
      { status: getRouteErrorStatus(error, getErrorStatus(error)), headers: PRIVATE_NO_STORE }
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
