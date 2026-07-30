import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("auth password reset flow", () => {
  it("keeps the login background mobile-safe and links to forgot password", () => {
    const login = read("app/login/page.tsx")
    const signup = read("app/signup/page.tsx")

    expect(login).toContain('href="/forgot-password"')
    expect(login).toContain("Forgot password?")
    expect(login).toContain("min-h-[100dvh]")
    expect(login).toContain("h-[100dvh]")
    expect(login).toContain("@media (max-width: 640px)")
    expect(login).toContain("radial-gradient(circle at 12% 18%")
    expect(login).toContain("auto 100%")
    expect(signup).toContain("min-h-[100dvh]")
    expect(signup).toContain("pinetree-app-bg.png")
    expect(signup).toContain("radial-gradient(circle at 12% 18%")
  })

  it("requests reset emails through the server route so no PKCE challenge is minted", () => {
    const forgotPassword = read("app/forgot-password/page.tsx")

    expect(forgotPassword).toContain("Reset your password")
    expect(forgotPassword).toContain('fetch("/api/auth/password-reset"')
    expect(forgotPassword).toContain("If an account exists for that email, a password reset link has been sent.")
    expect(forgotPassword).toContain("Enter a valid email address.")
    // The browser client is a PKCE client; requesting from it would bind the
    // recovery token to a verifier stored only in this browser.
    expect(forgotPassword).not.toContain("resetPasswordForEmail")
    expect(forgotPassword).not.toContain("@/lib/supabaseClient")
  })

  it("sends the reset email from an implicit-flow server client with no code challenge", () => {
    const route = read("app/api/auth/password-reset/route.ts")

    expect(route).toContain('flowType: "implicit"')
    expect(route).toContain("persistSession: false")
    expect(route).toContain("resetPasswordForEmail")
    expect(route).toContain("/auth/confirm")
    expect(route).toContain("ok: true")
    // Enumeration-safe: a provider error still answers generically.
    expect(route).toContain("recovery.request.provider_error")
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY")
  })

  it("verifies recovery links server-side with a token hash and no browser verifier", () => {
    const confirm = read("app/auth/confirm/route.ts")
    const server = read("lib/auth/recoveryServer.ts")

    expect(confirm).toContain("handleRecoveryVerification")
    expect(confirm).toContain("export async function HEAD")
    expect(confirm).toContain("export async function POST")
    expect(confirm).toContain('dynamic = "force-dynamic"')

    expect(server).toContain('verifyOtp({ token_hash: input.tokenHash!, type: "recovery" })')
    expect(server).toContain("RECOVERY_COOKIE_NAME")
    expect(server).toContain("httpOnly: true")
    expect(server).toContain('"no-store, private, max-age=0"')
    expect(server).toContain('"no-referrer"')
    expect(server).toContain("isRecoveryPrefetch")
    expect(server).toContain("classifyRecoveryUserAgent")
    expect(server).toContain("sanitizeRecoveryNext")
    expect(server).not.toContain("access_token")
    expect(server).not.toContain("refresh_token")
  })

  it("keeps the legacy PKCE callback working for already-delivered emails", () => {
    const callback = read("app/auth/callback/route.ts")

    expect(callback).toContain("handleRecoveryVerification")
    expect(callback).toContain("export async function HEAD")
    expect(callback).not.toContain("recovery_error=invalid")
  })

  it("projects controlled recovery failure categories instead of a blanket expiry claim", () => {
    const recovery = read("lib/auth/recovery.ts")
    const resetClient = read("app/reset-password/ResetPasswordClient.tsx")

    for (const code of [
      "missing_link",
      "malformed_link",
      "link_unusable",
      "link_expired",
      "link_used",
      "verification_failed",
      "verifier_unavailable",
      "rate_limited",
    ]) {
      expect(recovery).toContain(code)
    }
    // otp_expired covers invalid, expired and already-used tokens, so it must
    // not be projected as a definite expiry.
    expect(recovery).toContain('if (code === "otp_expired"')
    expect(recovery).toContain('return "link_unusable"')
    expect(recovery).toContain('code === "pkce_code_verifier_not_found"')

    expect(resetClient).toContain("recoveryErrorMessage(failureCode)")
    expect(resetClient).not.toContain(
      "This reset link is invalid, expired, or has already been used."
    )
  })

  it("emits recovery diagnostics in production without recording secrets", () => {
    const recovery = read("lib/auth/recovery.ts")

    expect(recovery).toContain("newRecoveryCorrelationId")
    expect(recovery).toContain('process.env.NODE_ENV === "test"')
    expect(recovery).not.toContain('process.env.NODE_ENV !== "development"')
    expect(recovery).toContain('scope: "auth-recovery"')
  })

  it("only renders the reset client for a matching server-issued recovery marker", () => {
    const resetPassword = read("app/reset-password/page.tsx")

    expect(resetPassword).toContain("cookieStore.get(RECOVERY_COOKIE_NAME)")
    expect(resetPassword).toContain("recoveryParam === recoveryCookie")
    expect(resetPassword).toContain("recoveryAuthorized={recoveryAuthorized}")
    expect(resetPassword).toContain("recoveryError={recoveryError}")
    expect(resetPassword).toContain('dynamic = "force-dynamic"')
  })

  it("validates, updates, verifies, and fully cleans up the recovery session", () => {
    const resetClient = read("app/reset-password/ResetPasswordClient.tsx")

    expect(resetClient).toContain("Create a new password")
    expect(resetClient).toContain("password.length < 11")
    expect(resetClient).toContain("Passwords do not match.")
    expect(resetClient).toContain("submittingRef.current")
    expect(resetClient).toContain("await supabase.auth.updateUser({ password })")
    expect(resetClient).toContain("error || !data.user")
    expect(resetClient).toContain("session.user.id !== data.user.id")
    expect(resetClient).toContain('signOut({ scope: "local" })')
    expect(resetClient).toContain("remainingSession")
    expect(resetClient).toContain('/auth/recovery/complete')
    expect(resetClient).toContain('window.history.replaceState(window.history.state, "", "/reset-password")')
    expect(resetClient).toContain("Password updated. Sign in with your new password.")
    expect(resetClient).toContain('window.location.replace("/login")')
    expect(resetClient).not.toContain("onAuthStateChange")
    expect(resetClient).not.toContain("finally")
  })

  it("does not let a recovery SIGNED_IN event race verified password login", () => {
    const login = read("app/login/page.tsx")

    expect(login).not.toContain("onAuthStateChange")
    expect(login).toContain('/auth/recovery/status')
    expect(login).toContain('signOut({ scope: "local" })')
    expect(login).toContain("signInResult = await supabase.auth.signInWithPassword")
    expect(login).toContain("!data.session || !data.user")
    expect(login).toContain("persistedSession.user.id !== data.user.id")
    expect(login).toContain('window.location.replace("/dashboard")')
    expect(login).toContain("login.redirect.verified_sign_in")
  })

  it("shows concise signup password requirements without changing auth validation", () => {
    const signup = read("app/signup/page.tsx")

    expect(signup).toContain("Password must:")
    expect(signup).toContain("• Be at least 11 characters")
    expect(signup).toContain("• Include one uppercase letter")
    expect(signup).toContain("• Include one lowercase letter")
    expect(signup).toContain("• Include one number")
    expect(signup).toContain("supabase.auth.signUp")
    expect(signup).not.toContain("password.length < 11")
  })

  it("documents a PineTree-branded token-hash reset email consistent with the code", () => {
    const template = read("docs/auth/supabase-email-templates.md")

    expect(template).toContain("PineTree Payments")
    expect(template).toContain("Reset your PineTree password")
    expect(template).toContain("Authentication -> Emails -> Reset Password")
    expect(template).toContain("support@pinetree-payments.com")
    expect(template).not.toContain("powered by Supabase")

    // Dashboard template must match app/auth/confirm/route.ts.
    expect(template).toContain(
      "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password"
    )
    expect(template).toContain("Site URL")
    expect(template).toContain("`https://app.pinetree-payments.com`")
    expect(template).toContain("`https://app.pinetree-payments.com/**`")
    expect(template).toContain("NEXT_PUBLIC_APP_URL")
  })
})
