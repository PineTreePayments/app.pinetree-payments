import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("dashboard layout - admin role fetched once per mount, not once per navigation", () => {
  const layout = read("app/dashboard/layout.tsx")

  const sessionEffectStart = layout.indexOf("async function checkSession()")
  const sessionEffectEnd = layout.indexOf("}, [pathname, router])", sessionEffectStart) + "}, [pathname, router])".length
  const sessionEffect = layout.slice(sessionEffectStart, sessionEffectEnd)

  const adminEffectStart = layout.indexOf("let cancelled = false")
  const adminEffectEnd = layout.indexOf("}, [])", adminEffectStart) + "}, [])".length
  const adminEffect = layout.slice(adminEffectStart, adminEffectEnd)

  it("keeps the session/redirect check running on every navigation (cheap - local getSession, no fetch)", () => {
    expect(sessionEffectStart).toBeGreaterThan(-1)
    expect(sessionEffect).toContain('router.replace("/login")')
    expect(sessionEffect).not.toContain("/api/admin/me")
  })

  it("fetches /api/admin/me exactly once per layout mount via an empty dependency array", () => {
    expect(adminEffectStart).toBeGreaterThan(-1)
    expect(adminEffect).toContain('fetch("/api/admin/me"')
    expect(adminEffect).toContain("setIsAdmin(meData.isAdmin === true)")

    // The effect wrapping loadAdminStatus must depend on [] (mount-once), not
    // [pathname, ...] - the dashboard layout persists across in-app
    // navigation, so a [] dependency array is what makes this run once per
    // session instead of once per page click.
    expect(adminEffect.trimEnd().endsWith("}, [])")).toBe(true)
  })

  it("only fetches /api/admin/me once in the whole file (no duplicate call sites)", () => {
    const matches = layout.match(/\/api\/admin\/me/g) || []
    expect(matches.length).toBe(1)
  })

  it("guards against a state update after the admin-role effect's owning component unmounted", () => {
    expect(adminEffect).toContain("let cancelled = false")
    expect(adminEffect).toContain("if (!cancelled && meRes.ok)")
    expect(adminEffect).toMatch(/return\s*\(\)\s*=>\s*\{\s*cancelled = true\s*\}/)
  })
})
