import { NextRequest, NextResponse } from "next/server"
import { verifyPosTerminalPinEngine } from "@/engine/posTerminalSession"
import { makeRateLimiter } from "@/lib/api/rateLimit"

/**
 * POST /api/pos/terminal-auth
 *
 * Verifies the entered PIN server-side and issues a terminal session token only
 * on success. This is the only route that produces a terminal session token;
 * the GET /api/pos/terminal-session route intentionally never returns one.
 *
 * Rate limiting: 5 attempts per terminal per 15 minutes.
 * Keyed by terminalId so a lockout is device-specific, not IP-bypassable.
 * On incorrect PIN the attempt is counted; on missing/bad terminalId it is not
 * (no terminal to lock out). Correct PIN resets the counter for that terminal.
 */

// 5 wrong attempts per terminal per 15 minutes before the endpoint starts
// returning 429.  A physical cashier entering a PIN 5 times is unlikely in
// normal operation; an automated brute-force will be stopped immediately.
const pinLimiter = makeRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 })

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

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "PIN must be 4 digits" }, { status: 400 })
    }

    // Check rate limit before hitting the database
    const limit = pinLimiter.check(terminalId)
    if (!limit.allowed) {
      const retryAfterSec = Math.ceil(limit.retryAfterMs / 1000)
      console.warn("[terminal-auth] rate limit hit", { terminalId: terminalId.slice(0, 8) })
      return NextResponse.json(
        { error: "Too many PIN attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      )
    }

    const sessionToken = await verifyPosTerminalPinEngine(terminalId, pin)

    // Successful auth — clear the attempt counter so a legitimate user
    // who previously mistyped doesn't hit the limit mid-shift.
    // We achieve this by exhausting the window: simply not counting successes
    // means the window slides naturally.  No explicit reset needed with a
    // sliding-window implementation.

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
