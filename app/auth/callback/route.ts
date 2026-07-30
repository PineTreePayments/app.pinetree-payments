import { randomUUID } from "node:crypto"
import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"
import {
  logRecoveryDiagnostic,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/recovery"

type CookieWrite = {
  name: string
  value: string
  options?: Parameters<NextResponse["cookies"]["set"]>[2]
}

function applyCookieWrites(response: NextResponse, writes: CookieWrite[]) {
  for (const { name, value, options } of writes) {
    response.cookies.set(name, value, options)
  }
}

function disableAuthResponseCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  return response
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const cookieWrites: CookieWrite[] = []

  logRecoveryDiagnostic("callback.received", { hasCode: Boolean(code) })

  if (!code) {
    logRecoveryDiagnostic("callback.rejected", { reason: "missing_code" })
    const invalidUrl = new URL("/reset-password?recovery_error=invalid", request.url)
    return disableAuthResponseCaching(NextResponse.redirect(invalidUrl))
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          cookieWrites.push(...cookiesToSet)
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session || !data.user) {
    logRecoveryDiagnostic("callback.exchange.failed", {
      errorCode: error?.code ?? "missing_session",
      status: error?.status ?? null,
    })
    if (request.cookies.has(RECOVERY_COOKIE_NAME)) {
      const { error: cleanupError } = await supabase.auth.signOut({ scope: "local" })
      logRecoveryDiagnostic("callback.reused_link.cleanup", {
        succeeded: !cleanupError,
        errorCode: cleanupError?.code ?? null,
      })
    }

    const invalidUrl = new URL("/reset-password?recovery_error=invalid", request.url)
    const response = NextResponse.redirect(invalidUrl)
    applyCookieWrites(response, cookieWrites)
    response.cookies.set(RECOVERY_COOKIE_NAME, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    return disableAuthResponseCaching(response)
  }

  const recoveryMarker = randomUUID()
  const resetUrl = new URL("/reset-password", request.url)
  resetUrl.searchParams.set("recovery", recoveryMarker)

  const response = NextResponse.redirect(resetUrl)
  applyCookieWrites(response, cookieWrites)
  response.cookies.set(RECOVERY_COOKIE_NAME, recoveryMarker, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })

  logRecoveryDiagnostic("callback.exchange.succeeded", {
    hasSession: true,
    hasUser: true,
  })
  return disableAuthResponseCaching(response)
}
