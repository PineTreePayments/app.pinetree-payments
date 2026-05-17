import { createHmac, timingSafeEqual } from "crypto"
import { NextRequest } from "next/server"

// 24-hour session lifetime. Long enough for a full business day without re-auth.
const TTL_SECONDS = 86400

type StatusError = Error & { status: number }

function statusError(message: string, status: number): StatusError {
  const err = new Error(message) as StatusError
  err.status = status
  return err
}

function getSecret(): string {
  const s = process.env.TERMINAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error("No terminal session secret configured")
  return s
}

export type TerminalSessionClaims = {
  mid: string  // merchantId
  tid: string  // terminalId
  exp: number  // unix expiry timestamp
}

/**
 * Signs a terminal session token for the given merchant + terminal pair.
 * Token format: pts_{base64url_payload}.{base64url_hmac}
 */
export function signTerminalSession(merchantId: string, terminalId: string): string {
  const claims: TerminalSessionClaims = {
    mid: merchantId,
    tid: terminalId,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url")
  return `pts_${payload}.${sig}`
}

/**
 * Verifies a terminal session token and returns its claims.
 * Throws on bad signature, wrong format, or expiry.
 */
export function verifyTerminalSession(token: string): TerminalSessionClaims {
  if (!token.startsWith("pts_")) throw new Error("Not a terminal session token")

  const inner = token.slice(4)
  const dot = inner.lastIndexOf(".")
  if (dot === -1) throw new Error("Malformed terminal session token")

  const payload = inner.slice(0, dot)
  const sig = inner.slice(dot + 1)

  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url")
  const aBuf = Buffer.from(sig, "base64url")
  const bBuf = Buffer.from(expected, "base64url")

  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    throw new Error("Invalid terminal session signature")
  }

  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as TerminalSessionClaims

  if (Math.floor(Date.now() / 1000) > claims.exp) {
    throw new Error("Terminal session expired")
  }

  return claims
}

/**
 * Extracts and verifies the terminal session token from the Authorization header.
 * Throws a 401 StatusError if missing or invalid.
 */
export function requireTerminalSession(req: NextRequest): TerminalSessionClaims {
  const auth = req.headers.get("authorization") ?? ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""

  if (!token) throw statusError("Missing terminal session token", 401)

  try {
    return verifyTerminalSession(token)
  } catch (err) {
    throw statusError(
      err instanceof Error ? err.message : "Invalid terminal session",
      401
    )
  }
}
