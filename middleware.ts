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
    pathname.startsWith("/api/dashboard/") ||
    pathname === "/api/transactions" ||
    pathname.startsWith("/api/wallets/") ||
    pathname === "/api/providers" ||
    pathname === "/api/settings" ||
    pathname.startsWith("/api/reports/")
  )
}

export async function middleware(req: NextRequest) {
  // Build a mutable response so @supabase/ssr can refresh session cookies when
  // needed (e.g. silent token rotation). The response is replaced inside
  // setAll() if any cookies need to be written back to the browser.
  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const { pathname } = req.nextUrl

  if (!user && (isProtectedPage(pathname) || isProtectedApi(pathname))) {
    if (isProtectedApi(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = "/login"
    return NextResponse.redirect(loginUrl)
  }

  return res
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/terminal/:path*",
    "/api/:path*",
  ],
}
