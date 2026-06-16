import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const COINBASE_OAUTH_COOKIE = "coinbase_oauth_context"

// Cookie expires in 5 minutes — enough for the Coinbase redirect round-trip.
export const COINBASE_OAUTH_COOKIE_MAX_AGE = 300

// Scopes requested from the Coinbase API.
// Override with COINBASE_OAUTH_SCOPES env var if a different scope set is needed.
export const COINBASE_OAUTH_SCOPES =
  process.env.COINBASE_OAUTH_SCOPES ?? "wallet:accounts:read,wallet:transactions:read"

// Generate a cryptographically random hex state token for CSRF protection.
export function generateCoinbaseState(): string {
  return randomBytes(16).toString("hex")
}

// Encode merchant_id + state into a base64url payload signed with HMAC-SHA256.
// Uses the same compact `payload.signature` format as the Shopify OAuth context.
export function createCoinbaseOAuthContext(
  input: { state: string; merchantId: string },
  secret: string
): string {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

// Verify the HMAC and decode the context. Returns null on any tampering or malform.
export function verifyCoinbaseOAuthContext(
  value: string,
  secret: string
): { state: string; merchantId: string } | null {
  const dot = value.indexOf(".")
  if (dot === -1) return null
  const payload = value.slice(0, dot)
  const signature = value.slice(dot + 1)
  if (!payload || !signature) return null

  const expected = createHmac("sha256", secret).update(payload).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(signature, "base64url")
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      state?: unknown
      merchantId?: unknown
    }
    if (typeof parsed.state !== "string" || typeof parsed.merchantId !== "string") return null
    if (!parsed.state || !parsed.merchantId) return null
    return { state: parsed.state, merchantId: parsed.merchantId }
  } catch {
    return null
  }
}
