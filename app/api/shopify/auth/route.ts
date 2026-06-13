import { NextRequest, NextResponse } from "next/server"
import { isValidShopDomain, buildShopifyAuthUrl, generateOAuthState } from "@/integrations/shopify/lib/oauth"

// GET /api/shopify/auth?shop=mystore.myshopify.com
//
// Initiates Shopify OAuth. The merchant must already be authenticated with
// PineTree so we can associate the shop with their PineTree account in the
// callback. Sets a short-lived HttpOnly CSRF state cookie then redirects to
// the Shopify authorization page.
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop") ?? ""

  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter. Expected format: mystore.myshopify.com" },
      { status: 400 }
    )
  }

  const clientId   = process.env.SHOPIFY_CLIENT_ID
  const rawAppUrl  = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !rawAppUrl) {
    return NextResponse.json(
      { error: "Shopify integration is not configured on this server." },
      { status: 503 }
    )
  }

  const appUrl      = rawAppUrl.replace(/\/$/, "")
  const redirectUri = `${appUrl}/api/shopify/auth/callback`
  const state       = generateOAuthState()
  const authUrl     = buildShopifyAuthUrl({ shop, clientId, redirectUri, state })

  const response = NextResponse.redirect(authUrl)

  // CSRF protection: state is set here and verified in the callback handler.
  // HttpOnly prevents XSS access; SameSite=Lax blocks cross-site POST injection.
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   300,  // 5 minutes — Shopify's authorization should complete well within this
    path:     "/api/shopify/auth/callback",
  })

  return response
}
