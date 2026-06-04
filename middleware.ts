import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

function isProtectedPage(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/terminal" ||
    pathname.startsWith("/terminal/")
  )
}

function isProtectedApi(pathname: string): boolean {
  return (
    pathname.startsWith("/api/admin/") ||      // defense-in-depth; routes also self-protect via requireAdminFromRequest
    pathname.startsWith("/api/dashboard/") ||
    pathname === "/api/transactions" ||
    pathname.startsWith("/api/wallets/") ||
    pathname === "/api/providers" ||
    pathname === "/api/settings" ||
    pathname.startsWith("/api/reports/")
  )
}

/**
 * Returns true for the three wallet approval routes that the mobile phone
 * must reach without being logged into PineTree:
 *   GET  /api/wallets/send-sessions/{id}          — read session for approval page
 *   PATCH /api/wallets/send-sessions/{id}         — update status (opened, wallet_connected, …)
 *   POST /api/wallets/send-sessions/{id}/complete — submit tx_hash / signature
 *
 * POST /api/wallets/send-sessions (no id segment) remains protected — only
 * logged-in merchants on desktop/POS create sessions.
 */
function isPublicWalletApprovalApi(req: NextRequest): boolean {
  const { pathname } = req.nextUrl
  const method = req.method

  // /api/wallets/send-sessions/{id}  — GET (load) and PATCH (status update)
  if (
    /^\/api\/wallets\/send-sessions\/[^/]+$/.test(pathname) &&
    (method === "GET" || method === "PATCH")
  ) {
    return true
  }

  // /api/wallets/send-sessions/{id}/complete  — POST (record tx_hash/signature)
  if (
    /^\/api\/wallets\/send-sessions\/[^/]+\/complete$/.test(pathname) &&
    method === "POST"
  ) {
    return true
  }

  // /api/wallets/send-sessions/{id}/refresh-tx  — POST (refresh Solana blockhash before signing)
  if (
    /^\/api\/wallets\/send-sessions\/[^/]+\/refresh-tx$/.test(pathname) &&
    method === "POST"
  ) {
    return true
  }

  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // CRITICAL: bypass Solana Pay requests — wallets do not send cookies
  if (pathname.startsWith("/api/solana-pay")) {
    return NextResponse.next()
  }

  // CRITICAL: bypass public wallet approval routes — the merchant's phone browser
  // scans a QR and opens these endpoints without a PineTree session cookie.
  // Session UUID possession is the access token for these routes.
  if (isPublicWalletApprovalApi(req)) {
    return NextResponse.next()
  }

  // Build a mutable response so @supabase/ssr can refresh session cookies when
  // needed (e.g. silent token rotation). The response is replaced inside
  // setAll() if any cookies need to be written back to the browser.
  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      },
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the JWT against Supabase — never use getSession() here
  // because it trusts the client-side cookie without server verification.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const protectedPage = isProtectedPage(pathname)
  const protectedApi = isProtectedApi(pathname)

  if (!user && (protectedPage || protectedApi)) {
    if (protectedApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = "/login"
    return NextResponse.redirect(loginUrl)
  }

  return res
}

export const config = {
  matcher: ["/dashboard/:path*", "/terminal/:path*", "/api/:path*"],
}
