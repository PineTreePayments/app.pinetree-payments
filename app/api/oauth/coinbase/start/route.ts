import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import {
  COINBASE_OAUTH_COOKIE,
  COINBASE_OAUTH_COOKIE_MAX_AGE,
  COINBASE_OAUTH_SCOPES,
  generateCoinbaseState,
  createCoinbaseOAuthContext,
} from "../context"

export async function GET(req: NextRequest) {
  const clientId = process.env.COINBASE_CLIENT_ID
  const clientSecret = process.env.COINBASE_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !clientSecret || !appUrl) {
    return NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_oauth_not_configured", req.url)
    )
  }

  // ── Resolve merchant from Supabase session cookie ─────────────────────────
  // This is a browser-initiated GET (no Authorization header), so we read the
  // session from the httpOnly Supabase auth cookie that was set on login.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_oauth_not_configured", req.url)
    )
  }

  const serverClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll() {
        /* read-only in this handler */
      },
    },
  })

  const {
    data: { user },
  } = await serverClient.auth.getUser()

  if (!user) {
    return NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_auth_required", req.url)
    )
  }

  // ── Build signed context cookie ───────────────────────────────────────────
  const merchantId = user.id
  const state = generateCoinbaseState()
  const context = createCoinbaseOAuthContext({ state, merchantId }, clientSecret)

  // ── Build Coinbase authorization URL ─────────────────────────────────────
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/oauth/coinbase/callback`
  const authUrl = new URL("https://www.coinbase.com/oauth/authorize")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", COINBASE_OAUTH_SCOPES)
  authUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set(COINBASE_OAUTH_COOKIE, context, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COINBASE_OAUTH_COOKIE_MAX_AGE,
    path: "/api/oauth/coinbase/callback",
  })
  return response
}
