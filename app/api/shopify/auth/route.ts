import { NextRequest, NextResponse } from "next/server"
import {
  buildShopifyAuthUrl,
  createOAuthContext,
  generateOAuthState,
  isValidShopDomain,
} from "@/integrations/shopify/lib/oauth"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

const OAUTH_COOKIE = "shopify_oauth_context"

function getConfig() {
  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  const rawAppUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !clientSecret || !rawAppUrl || !process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY) {
    return null
  }
  return { clientId, clientSecret, appUrl: rawAppUrl.replace(/\/$/, "") }
}

function setOAuthCookie(
  response: NextResponse,
  context: string
) {
  response.cookies.set(OAUTH_COOKIE, context, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/api/shopify/auth/callback",
  })
}

async function createAuthResponse(req: NextRequest, shop: string, redirect: boolean) {
  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Enter a valid Shopify store domain, such as mystore.myshopify.com." },
      { status: 400 }
    )
  }

  const config = getConfig()
  if (!config) {
    return NextResponse.json(
      { error: "Shopify connections are not configured yet. Review the setup guide and try again." },
      { status: 503 }
    )
  }

  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const state = generateOAuthState()
    const redirectUri = `${config.appUrl}/api/shopify/auth/callback`
    const authUrl = buildShopifyAuthUrl({
      shop,
      clientId: config.clientId,
      redirectUri,
      state,
    })
    const context = createOAuthContext({ state, merchantId }, config.clientSecret)
    const response = redirect
      ? NextResponse.redirect(authUrl)
      : NextResponse.json({ authUrl })
    setOAuthCookie(response, context)
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start Shopify connection." },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function GET(req: NextRequest) {
  return createAuthResponse(req, req.nextUrl.searchParams.get("shop")?.trim() ?? "", true)
}

export async function POST(req: NextRequest) {
  let body: { shop?: string }
  try {
    body = await req.json() as { shop?: string }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  return createAuthResponse(req, body.shop?.trim() ?? "", false)
}
