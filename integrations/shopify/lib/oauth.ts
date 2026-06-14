import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { SHOPIFY_APP_CONFIG } from "./config"

// Build the Shopify OAuth authorization URL to redirect the merchant to.
export function buildShopifyAuthUrl({
  shop,
  clientId,
  redirectUri,
  state,
  scopes = SHOPIFY_APP_CONFIG.REQUIRED_SCOPES,
}: {
  shop: string
  clientId: string
  redirectUri: string
  state: string
  scopes?: string
}): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("scope", scopes)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  return url.toString()
}

// Build the Shopify permanent access token exchange request body.
export function buildTokenExchangeBody({
  shop,
  clientId,
  clientSecret,
  code,
}: {
  shop: string
  clientId: string
  clientSecret: string
  code: string
}): { url: string; body: URLSearchParams } {
  return {
    url: `https://${shop}/admin/oauth/access_token`,
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code }),
  }
}

// Validate a Shopify shop domain against the *.myshopify.com pattern.
// Rejects paths, ports, protocol prefixes, and open-redirect attempts.
export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)
}

// Generate a cryptographically random hex state token for CSRF protection.
export function generateOAuthState(): string {
  return randomBytes(16).toString("hex")
}

export function createOAuthContext(
  input: { state: string; merchantId: string },
  secret: string
): string {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

export function verifyOAuthContext(
  value: string,
  secret: string
): { state: string; merchantId: string } | null {
  const [payload, signature] = value.split(".")
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
