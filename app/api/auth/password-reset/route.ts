import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { logRecoveryDiagnostic, newRecoveryCorrelationId } from "@/lib/auth/recovery"

/**
 * Requests a password reset email.
 *
 * This runs server-side on purpose. The browser client is a PKCE client, so
 * calling resetPasswordForEmail from the page would mint a code verifier in
 * browser cookies and attach a code challenge to the recovery token — state the
 * recovery link can only redeem if it is opened in that same browser profile.
 * Recovery is delivered by email and routinely opened somewhere else, so this
 * route uses an implicit-flow client that attaches no PKCE challenge at all. The
 * email link is then a pure one-time token that /auth/confirm verifies
 * server-side.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function resolveAppOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, "")
  return request.nextUrl.origin
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private, max-age=0" },
  })
}

export async function POST(request: NextRequest) {
  const correlationId = newRecoveryCorrelationId()

  let email = ""
  try {
    const payload = (await request.json()) as { email?: unknown }
    email = typeof payload.email === "string" ? payload.email.trim() : ""
  } catch {
    logRecoveryDiagnostic("recovery.request.rejected", {
      correlationId,
      reason: "bad_json",
    })
    return jsonResponse({ error: "invalid_request", correlationId }, 400)
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    logRecoveryDiagnostic("recovery.request.rejected", {
      correlationId,
      reason: "invalid_email",
    })
    return jsonResponse({ error: "invalid_email", correlationId }, 400)
  }

  const origin = resolveAppOrigin(request)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )

  logRecoveryDiagnostic("recovery.request.started", {
    correlationId,
    origin,
    strategy: "token_hash",
  })

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm`,
  })

  if (error) {
    // Still answered generically below so the response cannot be used to probe
    // which addresses have PineTree accounts.
    logRecoveryDiagnostic("recovery.request.provider_error", {
      correlationId,
      supabaseErrorCode: error.code ?? "unknown",
      supabaseStatus: error.status ?? null,
    })
  } else {
    logRecoveryDiagnostic("recovery.request.accepted", { correlationId })
  }

  return jsonResponse({ ok: true, correlationId })
}
