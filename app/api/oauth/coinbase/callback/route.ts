import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"
import {
  COINBASE_OAUTH_COOKIE,
  verifyCoinbaseOAuthContext,
} from "../context"

const db = supabaseAdmin || supabaseAnon

const COINBASE_PROVIDER_NAME = "coinbase_oauth"

type CoinbaseTokenData = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

async function saveCoinbaseOAuthCredentials(
  merchantId: string,
  tokenData: CoinbaseTokenData
): Promise<void> {
  const now = new Date().toISOString()

  const credentials: Record<string, unknown> = {
    access_token: tokenData.access_token,
    connected_at: now,
  }
  if (tokenData.refresh_token) credentials.refresh_token = tokenData.refresh_token
  if (typeof tokenData.expires_in === "number") credentials.expires_in = tokenData.expires_in
  if (tokenData.token_type) credentials.token_type = tokenData.token_type

  const { data: existing } = await db
    .from("merchant_providers")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("provider", COINBASE_PROVIDER_NAME)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await db
      .from("merchant_providers")
      .update({ credentials, status: "connected", enabled: true, updated_at: now })
      .eq("id", existing.id)
    if (error) throw new Error(`Failed to update Coinbase credentials: ${error.message}`)
    return
  }

  const { error } = await db.from("merchant_providers").insert({
    merchant_id: merchantId,
    provider: COINBASE_PROVIDER_NAME,
    status: "connected",
    enabled: true,
    credentials,
    created_at: now,
    updated_at: now,
  })
  if (error) throw new Error(`Failed to store Coinbase credentials: ${error.message}`)
}

// Clears the context cookie on the given response so it is never reused.
function clearContextCookie(response: NextResponse): void {
  response.cookies.set(COINBASE_OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/oauth/coinbase/callback",
  })
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const stateParam = req.nextUrl.searchParams.get("state")

  // Both params are required — Coinbase always provides them on success.
  if (!code || !stateParam) {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_invalid_callback", req.url)
    )
    clearContextCookie(res)
    return res
  }

  // ── Verify signed OAuth context cookie ────────────────────────────────────
  // The start route wrote an HMAC-signed cookie containing {state, merchantId}.
  // We verify the signature and check state matches — extracting merchantId
  // from the signed cookie rather than relying on the active browser session.
  const clientSecret = process.env.COINBASE_CLIENT_SECRET
  const clientId = process.env.COINBASE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !clientSecret || !appUrl) {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_oauth_not_configured", req.url)
    )
    clearContextCookie(res)
    return res
  }

  const rawCookie = req.cookies.get(COINBASE_OAUTH_COOKIE)?.value ?? ""
  const context = rawCookie ? verifyCoinbaseOAuthContext(rawCookie, clientSecret) : null

  if (!context) {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_missing_context", req.url)
    )
    clearContextCookie(res)
    return res
  }

  if (context.state !== stateParam) {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_state_mismatch", req.url)
    )
    clearContextCookie(res)
    return res
  }

  const { merchantId } = context

  // ── Token exchange ────────────────────────────────────────────────────────
  let tokenData: CoinbaseTokenData
  try {
    const tokenRes = await fetch("https://api.coinbase.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl.replace(/\/$/, "")}/api/oauth/coinbase/callback`,
      }),
    })

    if (!tokenRes.ok) {
      const res = NextResponse.redirect(
        new URL("/dashboard/providers?error=coinbase_oauth_failed", req.url)
      )
      clearContextCookie(res)
      return res
    }

    tokenData = (await tokenRes.json()) as CoinbaseTokenData
  } catch {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_oauth_failed", req.url)
    )
    clearContextCookie(res)
    return res
  }

  if (!tokenData.access_token) {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_oauth_failed", req.url)
    )
    clearContextCookie(res)
    return res
  }

  // ── Persist credentials server-side only ─────────────────────────────────
  try {
    await saveCoinbaseOAuthCredentials(merchantId, tokenData)
  } catch {
    const res = NextResponse.redirect(
      new URL("/dashboard/providers?error=coinbase_oauth_save_failed", req.url)
    )
    clearContextCookie(res)
    return res
  }

  const res = NextResponse.redirect(
    new URL("/dashboard/providers?connected=coinbase", req.url)
  )
  clearContextCookie(res)
  return res
}
