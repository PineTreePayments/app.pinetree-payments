import { NextRequest, NextResponse } from "next/server"
import { verifyPosTerminalExitPinEngine } from "@/engine/posTerminalSession"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { makeRateLimiter } from "@/lib/api/rateLimit"

/**
 * POST /api/pos/terminal-exit-auth
 *
 * Authorizes LEAVING the active terminal. The PIN is PineTree's exit gate: a
 * cashier never types it to start selling, only to return to the dashboard or
 * reach the protected terminal-management controls.
 *
 * This route issues no credential. It answers one question — "may this session
 * exit?" — and a success response must never be usable as a replacement
 * terminal session. That is why nothing token-shaped appears in the body.
 *
 * Identity comes entirely from the caller's existing `pts_` terminal session, so
 * a PIN can only ever exit the terminal it was issued for; there is no
 * `terminalId` field in the request. A caller with no valid session is rejected
 * before the PIN is read, so this route cannot be used to test PINs against
 * arbitrary terminal ids.
 *
 * Rate limiting: 5 attempts per terminal per 15 minutes, keyed on the terminal
 * id from the signed claims rather than anything the caller supplies.
 */
const exitPinLimiter = makeRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 })

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const

export async function POST(req: NextRequest) {
  let terminalId: string
  let merchantId: string

  try {
    const claims = requireTerminalSession(req)
    merchantId = claims.mid
    terminalId = claims.tid
  } catch {
    return NextResponse.json(
      { error: "A valid terminal session is required" },
      { status: 401, headers: PRIVATE_NO_STORE }
    )
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { pin?: string }
    const pin = String(body.pin || "").trim()

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { error: "PIN must be 4 digits" },
        { status: 400, headers: PRIVATE_NO_STORE }
      )
    }

    const limit = exitPinLimiter.check(terminalId)
    if (!limit.allowed) {
      const retryAfterSec = Math.ceil(limit.retryAfterMs / 1000)
      console.warn("[terminal-exit-auth] rate limit hit", { terminalId: terminalId.slice(0, 8) })
      return NextResponse.json(
        { error: "Too many PIN attempts. Please wait before trying again." },
        {
          status: 429,
          headers: { ...PRIVATE_NO_STORE, "Retry-After": String(retryAfterSec) },
        }
      )
    }

    await verifyPosTerminalExitPinEngine({ merchantId, terminalId, pin })

    // Correct PIN — clear the counter so a cashier who mistyped earlier in the
    // shift is not locked out of leaving at closing time.
    exitPinLimiter.reset(terminalId)

    // Authorization for the exit action only. No terminal session is returned.
    return NextResponse.json({ exitAuthorized: true }, { headers: PRIVATE_NO_STORE })
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: number }).status) || 500
        : 500
    const message = error instanceof Error ? error.message : "PIN verification failed"
    return NextResponse.json({ error: message }, { status, headers: PRIVATE_NO_STORE })
  }
}
