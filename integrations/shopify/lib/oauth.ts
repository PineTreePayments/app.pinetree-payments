import { randomBytes } from "node:crypto"
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
