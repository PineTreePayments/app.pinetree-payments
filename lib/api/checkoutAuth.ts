import { createHmac, timingSafeEqual } from "crypto"

const TTL_SECONDS = 86400 // 24 hours — matches typical payment intent TTL

export type CheckoutSessionClaims = {
  iid: string  // intentId that originated this checkout session
  exp: number  // unix expiry timestamp
}

function getSecret(): string {
  const s =
    process.env.CHECKOUT_SESSION_SECRET ||
    process.env.TERMINAL_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error("No checkout session secret configured")
  return s
}

/**
 * Issues a short-lived HMAC-signed checkout session token scoped to one payment intent.
 * Token format: pco_{base64url_payload}.{base64url_hmac}
 *
 * Only authorises customer-safe checkout actions (fail/cancel) for payments that
 * belong to the specified intent.  Cannot be used for merchant or admin routes.
 */
export function signCheckoutSession(intentId: string): string {
  const claims: CheckoutSessionClaims = {
    iid: intentId,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url")
  return `pco_${payload}.${sig}`
}

/**
 * Verifies a checkout session token and returns its claims.
 * Throws on bad signature, wrong format, or expiry.
 */
export function verifyCheckoutSession(token: string): CheckoutSessionClaims {
  if (!token.startsWith("pco_")) throw new Error("Not a checkout session token")

  const inner = token.slice(4)
  const dot = inner.lastIndexOf(".")
  if (dot === -1) throw new Error("Malformed checkout session token")

  const payload = inner.slice(0, dot)
  const sig = inner.slice(dot + 1)

  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url")
  const aBuf = Buffer.from(sig, "base64url")
  const bBuf = Buffer.from(expected, "base64url")

  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    throw new Error("Invalid checkout session signature")
  }

  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as CheckoutSessionClaims

  if (Math.floor(Date.now() / 1000) > claims.exp) {
    throw new Error("Checkout session expired")
  }

  return claims
}
