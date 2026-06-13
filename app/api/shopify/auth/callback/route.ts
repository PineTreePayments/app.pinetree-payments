import { NextRequest, NextResponse } from "next/server"
import { isValidShopDomain, buildTokenExchangeBody } from "@/integrations/shopify/lib/oauth"
import { verifyShopifyOAuthCallback } from "@/integrations/shopify/lib/hmac"
// import { encryptShopifyToken } from "@/integrations/shopify/lib/crypto"
// Uncomment the line above when persisting tokens (requires SHOPIFY_TOKEN_ENCRYPTION_KEY).

// GET /api/shopify/auth/callback
//
// Shopify redirects here after the merchant authorizes the app.
// 1. Verifies the CSRF state cookie set in /api/shopify/auth.
// 2. Verifies Shopify's HMAC signature over all callback query params.
// 3. Exchanges the authorization code for a permanent access token.
// 4. TODO: looks up the PineTree merchant session and persists shopify_connections.
export async function GET(req: NextRequest) {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  const clientId     = process.env.SHOPIFY_CLIENT_ID
  const rawAppUrl    = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !clientSecret || !rawAppUrl) {
    return NextResponse.json(
      { error: "Shopify integration is not configured on this server." },
      { status: 503 }
    )
  }

  // ── 1. CSRF state verification ───────────────────────────────────────────────
  const stateCookie = req.cookies.get("shopify_oauth_state")?.value ?? ""
  const stateParam  = req.nextUrl.searchParams.get("state") ?? ""

  if (!stateCookie || stateCookie !== stateParam) {
    return NextResponse.json(
      { error: "OAuth state mismatch. Possible CSRF attempt." },
      { status: 401 }
    )
  }

  // ── 2. Shopify HMAC verification ─────────────────────────────────────────────
  const params: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((value, key) => { params[key] = value })

  if (!verifyShopifyOAuthCallback(params, clientSecret)) {
    return NextResponse.json({ error: "Invalid HMAC signature." }, { status: 401 })
  }

  const shop = params["shop"] ?? ""
  const code = params["code"] ?? ""

  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json({ error: "Invalid shop domain." }, { status: 400 })
  }
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code." }, { status: 400 })
  }

  // ── 3. Token exchange ────────────────────────────────────────────────────────
  const appUrl = rawAppUrl.replace(/\/$/, "")
  const { url: tokenUrl, body: tokenBody } = buildTokenExchangeBody({
    shop, clientId, clientSecret, code,
  })

  let accessToken: string
  let grantedScopes: string
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    })
    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: "Token exchange failed.", detail: `Shopify returned ${tokenRes.status}` },
        { status: 502 }
      )
    }
    const data = await tokenRes.json() as { access_token?: string; scope?: string }
    if (!data.access_token) {
      return NextResponse.json({ error: "Shopify did not return an access token." }, { status: 502 })
    }
    accessToken   = data.access_token
    grantedScopes = data.scope ?? ""
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: "Token exchange request failed.", detail: message }, { status: 502 })
  }

  // ── 4. Persist connection (TODO) ─────────────────────────────────────────────
  //
  // Requirements before uncommenting:
  //   a) Identify the PineTree merchant from their existing session cookie/JWT.
  //   b) Set SHOPIFY_TOKEN_ENCRYPTION_KEY (64-char hex, 32 bytes).
  //   c) Run database migration: 20260613_create_shopify_connections.sql.
  //
  //   const encryptedToken = encryptShopifyToken(accessToken)
  //   await db.query(
  //     `INSERT INTO shopify_connections (shop, merchant_id, access_token, scopes, status)
  //      VALUES ($1, $2, $3, $4, 'active')
  //      ON CONFLICT (shop) WHERE status = 'active' DO UPDATE
  //        SET access_token = EXCLUDED.access_token,
  //            scopes       = EXCLUDED.scopes,
  //            updated_at   = now()`,
  //     [shop, merchantId, encryptedToken, grantedScopes]
  //   )

  void accessToken    // used in TODO above — suppress unused-var lint until wired
  void grantedScopes  // same

  const dashboardUrl = `${appUrl}/dashboard/developer?shopify=connected&shop=${encodeURIComponent(shop)}`

  // Clear the CSRF state cookie now that it has been consumed.
  const response = NextResponse.redirect(dashboardUrl)
  response.cookies.delete("shopify_oauth_state")
  return response
}
