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
    expect(forgotPassword).toContain("process.env.NEXT_PUBLIC_APP_URL")
    expect(forgotPassword).toContain("window.location.origin")
    expect(forgotPassword).toContain("If an account exists for that email, a password reset link has been sent.")
    expect(forgotPassword).toContain("Enter a valid email address.")
  })

  it("adds a reset-password page that validates and updates the password", () => {
    const resetPassword = read("app/reset-password/page.tsx")

    expect(resetPassword).toContain("Create a new password")
    expect(resetPassword).toContain("password.length < 8")
    expect(resetPassword).toContain("Passwords do not match.")
    expect(resetPassword).toContain("supabase.auth.updateUser({ password })")
    expect(resetPassword).toContain("Your password has been updated.")
    expect(resetPassword).toContain("PASSWORD_RECOVERY")
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
