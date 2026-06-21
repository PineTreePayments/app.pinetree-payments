import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("passkey support", () => {
  it("login page still has email, password fields and forgot-password link", () => {
    const login = read("app/login/page.tsx")
    expect(login).toContain('type="email"')
    expect(login).toContain('type={showPassword ? "text" : "password"}')
    expect(login).toContain("Forgot password?")
    expect(login).toContain('href="/forgot-password"')
    expect(login).toContain("Create account")
    expect(login).toContain("signInWithPassword")
  })

  it("login page does not render a visible passkey button or link", () => {
    const login = read("app/login/page.tsx")

    expect(login).not.toContain("Use a passkey")
    expect(login).not.toContain("handlePasskeySignIn")
    expect(login).not.toContain("signInWithPasskey")
    expect(login).not.toContain("passkeyMsg")
    expect(login).not.toContain('mode === "login" && passkeySupported')
  })

  it("login page safely detects conditional passkey mediation and uses webauthn autocomplete", () => {
    const login = read("app/login/page.tsx")
    expect(login).toContain("isConditionalMediationAvailable")
    expect(login).toContain("conditionalPasskeySupported")
    expect(login).toContain('"username webauthn"')
    expect(login).toContain('"email"')
  })

  it("login page has no visible passkey cancellation error surface", () => {
    const login = read("app/login/page.tsx")
    expect(login).not.toContain("Passkey sign-in was cancelled.")
    expect(login).not.toContain('passkeyMsg && (\n            <p className="text-sm text-red-600')
  })

  it("login page detects conditional passkey support via PublicKeyCredential", () => {
    const login = read("app/login/page.tsx")
    expect(login).toContain("window.PublicKeyCredential")
    expect(login).toContain("setConditionalPasskeySupported")
    expect(login).toContain("TODO: Supabase passkey helpers are still experimental")
  })

  it("settings page has passkey registration section with correct copy", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    expect(settings).toContain("registerPasskey")
    expect(settings).toContain("Add passkey")
    expect(settings).toContain("Passkey added.")
    expect(settings).toContain("Face ID")
    expect(settings).toContain("Touch ID")
    expect(settings).toContain("Windows Hello")
  })

  it("settings passkey registration handles cancellation without throwing", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    expect(settings).toContain("Passkey setup was cancelled.")
    expect(settings).toContain("handleAddPasskey")
  })

  it("supabase browser client enables experimental passkey flag", () => {
    const client = read("lib/supabaseClient.ts")
    expect(client).toContain("experimental")
    expect(client).toContain("passkey: true")
  })
})
