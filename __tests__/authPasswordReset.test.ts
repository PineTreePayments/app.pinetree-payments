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

  it("adds a forgot-password page that sends Supabase reset links", () => {
    const forgotPassword = read("app/forgot-password/page.tsx")

    expect(forgotPassword).toContain("Reset your password")
    expect(forgotPassword).toContain("resetPasswordForEmail")
    expect(forgotPassword).toContain("redirectTo: getResetRedirectUrl()")
    expect(forgotPassword).toContain('/auth/callback')
    expect(forgotPassword).toContain("process.env.NEXT_PUBLIC_APP_URL")
    expect(forgotPassword).toContain("window.location.origin")
    expect(forgotPassword).toContain("If an account exists for that email, a password reset link has been sent.")
    expect(forgotPassword).toContain("Enter a valid email address.")
  })

  it("exchanges the PKCE code on the server and issues a server recovery marker", () => {
    const callback = read("app/auth/callback/route.ts")

    expect(callback).toContain("exchangeCodeForSession(code)")
    expect(callback).toContain("!data.session || !data.user")
    expect(callback).toContain("randomUUID()")
    expect(callback).toContain("RECOVERY_COOKIE_NAME")
    expect(callback).toContain("httpOnly: true")
    expect(callback).toContain('Cache-Control", "private, no-store, max-age=0')
    expect(callback).toContain("recovery_error=invalid")
    expect(callback).not.toContain("access_token")
    expect(callback).not.toContain("refresh_token")
  })

  it("only renders the reset client for a matching server-issued recovery marker", () => {
    const resetPassword = read("app/reset-password/page.tsx")

    expect(resetPassword).toContain("cookieStore.get(RECOVERY_COOKIE_NAME)")
    expect(resetPassword).toContain("recoveryParam === recoveryCookie")
    expect(resetPassword).toContain("recoveryAuthorized={recoveryAuthorized}")
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

  it("documents PineTree-branded Supabase reset email template", () => {
    const template = read("docs/auth/supabase-email-templates.md")

    expect(template).toContain("PineTree Payments")
    expect(template).toContain("Reset your PineTree password")
    expect(template).toContain("{{ .ConfirmationURL }}")
    expect(template).toContain("Authentication -> Emails -> Reset Password")
    expect(template).toContain("support@pinetree-payments.com")
    expect(template).not.toContain("powered by Supabase")
    expect(template).not.toContain("Supabase Auth")
  })
})
