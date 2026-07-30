import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"
import {
  classifyRecoveryError,
  classifyRecoveryUserAgent,
  isRecoveryPrefetch,
  logRecoveryDiagnostic,
  newRecoveryCorrelationId,
  RECOVERY_COOKIE_NAME,
  RECOVERY_DEFAULT_NEXT,
  sanitizeRecoveryNext,
  type RecoveryErrorCode,
} from "./recovery"

type CookieWrite = {
  name: string
  value: string
  options?: Parameters<NextResponse["cookies"]["set"]>[2]
}

const RECOVERY_MARKER_COOKIE_OPTIONS = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const

/**
 * Recovery endpoints handle a single-use credential. Nothing about them may be
 * cached, indexed, or leaked through a referrer.
 */
function hardenRecoveryResponse<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store, private, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")
  return response
}

function applyCookieWrites(response: NextResponse, writes: CookieWrite[]) {
  for (const { name, value, options } of writes) {
    response.cookies.set(name, value, options)
  }
}

function clearRecoveryMarker(response: NextResponse) {
  response.cookies.set(RECOVERY_COOKIE_NAME, "", {
    ...RECOVERY_MARKER_COOKIE_OPTIONS,
    maxAge: 0,
  })
}

function failureRedirect(
  request: NextRequest,
  next: string,
  errorCode: RecoveryErrorCode,
  cookieWrites: CookieWrite[] = []
) {
  const url = new URL(next, request.nextUrl.origin)
  url.searchParams.set("recovery_error", errorCode)
  const response = NextResponse.redirect(url, 303)
  applyCookieWrites(response, cookieWrites)
  // A failed attempt must never leave a usable recovery marker behind.
  clearRecoveryMarker(response)
  return hardenRecoveryResponse(response)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Served to automated clients (mail-security scanners, unfurlers, crawlers)
 * instead of spending the credential. A genuine person behind such a client
 * still completes the reset with one extra tap, and the form POST is not
 * something link scanners perform.
 */
function scannerInterstitial(
  route: string,
  fields: Record<string, string>,
  correlationId: string
) {
  const inputs = Object.entries(fields)
    .filter(([, value]) => value)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
    )
    .join("")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<title>Confirm your PineTree password reset</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f8fb;font-family:Inter,Arial,sans-serif;color:#111827;">
<main style="max-width:420px;padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;text-align:center;">
<div style="font-size:20px;font-weight:800;color:#0052ff;">PineTree Payments</div>
<h1 style="font-size:20px;margin:16px 0 8px;">Confirm your password reset</h1>
<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 20px;">
Select continue to open the password reset form. This extra step protects your
reset link from automated email scanners.
</p>
<form method="POST" action="${escapeHtml(route)}">${inputs}
<button type="submit" style="width:100%;padding:12px 18px;border:0;border-radius:12px;background:#0052ff;color:#ffffff;font-size:15px;font-weight:700;cursor:pointer;">Continue</button>
</form>
</main>
</body>
</html>`

  logRecoveryDiagnostic("recovery.interstitial.served", { correlationId, route })

  return hardenRecoveryResponse(
    new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  ) as NextResponse
}

export type RecoveryVerificationInput = {
  tokenHash: string | null
  code: string | null
  type: string | null
  next: string
}

export function readRecoveryInput(params: URLSearchParams): RecoveryVerificationInput {
  return {
    tokenHash: params.get("token_hash"),
    code: params.get("code"),
    type: params.get("type"),
    next: sanitizeRecoveryNext(params.get("next")),
  }
}

/**
 * A HEAD probe must be answerable without touching the credential. Mail
 * scanners commonly send HEAD before (or instead of) a real GET.
 */
export function recoveryHeadResponse(route: string) {
  logRecoveryDiagnostic("recovery.head.ignored", { route })
  return hardenRecoveryResponse(new NextResponse(null, { status: 200 }))
}

/**
 * Shared recovery verification.
 *
 * Primary strategy is `token_hash` + `verifyOtp`, which is verified entirely
 * server-side and therefore works no matter which browser, in-app webview, or
 * device opens the email. The `code`/`exchangeCodeForSession` strategy is kept
 * only so links from already-delivered emails still resolve; it depends on a
 * PKCE verifier cookie that the opening browser frequently does not have.
 */
export async function handleRecoveryVerification(
  request: NextRequest,
  options: { route: string; method: "GET" | "POST"; input: RecoveryVerificationInput }
): Promise<NextResponse> {
  const { route, method, input } = options
  const correlationId = newRecoveryCorrelationId()
  const userAgentClass = classifyRecoveryUserAgent(request.headers.get("user-agent"))
  const strategy = input.tokenHash ? "token_hash" : input.code ? "pkce" : "none"
  const hasVerifierCookie = request.cookies
    .getAll()
    .some(({ name }) => name.endsWith("-auth-token-code-verifier"))

  logRecoveryDiagnostic("recovery.callback.received", {
    correlationId,
    route,
    method,
    origin: request.nextUrl.origin,
    protocol: request.nextUrl.protocol,
    userAgentClass,
    hasTokenHash: Boolean(input.tokenHash),
    hasCode: Boolean(input.code),
    hasVerifier: hasVerifierCookie,
    type: input.type ?? null,
    strategy,
    next: input.next,
  })

  if (isRecoveryPrefetch(request.headers)) {
    logRecoveryDiagnostic("recovery.callback.prefetch_ignored", { correlationId, route })
    return hardenRecoveryResponse(new NextResponse(null, { status: 204 }))
  }

  if (strategy === "none") {
    logRecoveryDiagnostic("recovery.callback.rejected", {
      correlationId,
      route,
      outcome: "missing_link",
    })
    return failureRedirect(request, input.next, "missing_link")
  }

  if (strategy === "token_hash" && input.type !== "recovery") {
    logRecoveryDiagnostic("recovery.callback.rejected", {
      correlationId,
      route,
      outcome: "malformed_link",
      type: input.type ?? null,
    })
    return failureRedirect(request, input.next, "malformed_link")
  }

  // Automated clients get the interstitial rather than spending the credential.
  // POST is already past that gate.
  if (method === "GET" && userAgentClass === "automated") {
    return scannerInterstitial(
      route,
      {
        token_hash: input.tokenHash ?? "",
        code: input.code ?? "",
        type: input.type ?? "",
        next: input.next,
      },
      correlationId
    )
  }

  const cookieWrites: CookieWrite[] = []
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

  const { data, error } =
    strategy === "token_hash"
      ? await supabase.auth.verifyOtp({ token_hash: input.tokenHash!, type: "recovery" })
      : await supabase.auth.exchangeCodeForSession(input.code!)

  if (error || !data?.session || !data?.user) {
    const outcome = classifyRecoveryError(
      error ? { code: error.code, status: error.status, name: error.name } : null
    )
    logRecoveryDiagnostic("recovery.callback.failed", {
      correlationId,
      route,
      strategy,
      hasVerifier: hasVerifierCookie,
      supabaseErrorCode: error?.code ?? (error ? "unknown" : "missing_session"),
      supabaseStatus: error?.status ?? null,
      outcome,
    })
    return failureRedirect(request, input.next, outcome, cookieWrites)
  }

  const recoveryMarker = newRecoveryCorrelationId()
  const resetUrl = new URL(input.next, request.nextUrl.origin)
  resetUrl.searchParams.set("recovery", recoveryMarker)

  const response = NextResponse.redirect(resetUrl, 303)
  applyCookieWrites(response, cookieWrites)
  response.cookies.set(RECOVERY_COOKIE_NAME, recoveryMarker, RECOVERY_MARKER_COOKIE_OPTIONS)

  logRecoveryDiagnostic("recovery.callback.succeeded", {
    correlationId,
    route,
    strategy,
    outcome: "verified",
    next: input.next,
  })

  return hardenRecoveryResponse(response)
}

export { RECOVERY_DEFAULT_NEXT }
