import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("auth password reset flow", () => {
  it("keeps the login background mobile-safe and links to forgot password", () => {
    const login = read("app/login/page.tsx")

    expect(login).toContain('href="/forgot-password"')
    expect(login).toContain("Forgot password?")
    expect(login).toContain("min-h-[100dvh]")
    expect(login).toContain("h-[100dvh]")
    expect(login).toContain("@media (max-width: 640px)")
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
})
