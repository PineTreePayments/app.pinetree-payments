import { NextResponse } from "next/server"

/**
 * RETIRED — PIN-for-credential terminal login.
 *
 * This route used to verify a terminal PIN and return a signed 24-hour `pts_`
 * terminal session. It existed because the PIN was treated as an *entry* gate.
 *
 * PineTree's terminal contract is the opposite: launching a configured terminal
 * opens the POS immediately, and the PIN guards *leaving* it. The two routes
 * that replace this one are:
 *
 *   GET  /api/pos/terminal-session    — authenticated merchant launch. Verifies
 *                                       the merchant session and that the
 *                                       merchant owns the terminal, then issues
 *                                       the scoped `pts_` credential.
 *   POST /api/pos/terminal-exit-auth  — verifies the PIN to authorize leaving the
 *                                       active terminal. Issues no credential.
 *
 * It is retired rather than left in place because it was the last endpoint that
 * minted a merchant-scoped credential from an unauthenticated request holding
 * only a terminal id and a 4-digit secret — the surface audit finding RA-1 was
 * about. Nothing calls it: no source import, no test, and no frontend reference.
 *
 * See docs/security/route-auth-matrix.md (RA-1).
 */

const RETIRED_BODY = {
  error: "Gone",
  message:
    "Terminal PIN login has been retired. A terminal session is issued by the authenticated launch route; the PIN now authorizes leaving the terminal.",
} as const

function retired() {
  return NextResponse.json(RETIRED_BODY, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST() {
  return retired()
}

export async function GET() {
  return retired()
}
