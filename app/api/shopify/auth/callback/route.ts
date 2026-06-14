import { NextRequest, NextResponse } from "next/server"
import { upsertShopifyConnection } from "@/database/shopifyConnections"
import { encryptShopifyToken } from "@/integrations/shopify/lib/crypto"
import { verifyShopifyOAuthCallback } from "@/integrations/shopify/lib/hmac"
import {
  buildTokenExchangeBody,
  isValidShopDomain,
  verifyOAuthContext,
} from "@/integrations/shopify/lib/oauth"

const OAUTH_COOKIE = "shopify_oauth_context"

export async function GET(req: NextRequest) {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  const clientId = process.env.SHOPIFY_CLIENT_ID
  const rawAppUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !clientSecret || !rawAppUrl || !process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: "Shopify connections are not configured yet. Review the setup guide and try again." },
      { status: 503 }
    )
  }

  const params: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((value, key) => { params[key] = value })

  const context = verifyOAuthContext(req.cookies.get(OAUTH_COOKIE)?.value ?? "", clientSecret)
  const state = params.state ?? ""
  if (!context || context.state !== state) {
    return NextResponse.json(
      { error: "This Shopify connection could not be linked to your PineTree account. Start the connection again from Developer." },
      { status: 401 }
    )
  }

  if (!verifyShopifyOAuthCallback(params, clientSecret)) {
    return NextResponse.json({ error: "Shopify could not verify this connection." }, { status: 401 })
  }

  const shop = params.shop ?? ""
  const code = params.code ?? ""
  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json({ error: "Shopify returned an invalid store domain." }, { status: 400 })
  }
  if (!code) {
    return NextResponse.json({ error: "Shopify did not return an authorization code." }, { status: 400 })
  }

  const { url, body } = buildTokenExchangeBody({ shop, clientId, clientSecret, code })
  try {
    const tokenResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
    if (!tokenResponse.ok) {
      return NextResponse.json(
        { error: "Shopify could not complete the connection." },
        { status: 502 }
      )
    }

    const token = await tokenResponse.json() as { access_token?: string; scope?: string }
    if (!token.access_token) {
      return NextResponse.json({ error: "Shopify did not return a connection token." }, { status: 502 })
    }

    await upsertShopifyConnection({
      shop,
      merchantId: context.merchantId,
      encryptedToken: encryptShopifyToken(token.access_token),
      scopes: token.scope ?? "",
    })
  } catch {
    return NextResponse.json(
      { error: "PineTree could not save the Shopify connection. Try again." },
      { status: 502 }
    )
  }

  const dashboardUrl = `${rawAppUrl.replace(/\/$/, "")}/dashboard/developer?shopify=connected`
  const response = NextResponse.redirect(dashboardUrl)
  response.cookies.delete(OAUTH_COOKIE)
  return response
}
