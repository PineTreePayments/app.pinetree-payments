import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

function listRouteFiles(dir: string): string[] {
  const absoluteDir = path.join(process.cwd(), dir)
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listRouteFiles(relativePath)
    return entry.name === "route.ts" ? [relativePath] : []
  })
}

describe("admin route protection", () => {
  it("protects direct admin page navigation in middleware", () => {
    const middleware = read("middleware.ts")

    expect(middleware).toContain('pathname === "/dashboard/admin"')
    expect(middleware).toContain('pathname.startsWith("/dashboard/admin/")')
    expect(middleware).toContain('.select("role")')
    expect(middleware).toContain('data?.role === "admin"')
    expect(middleware).toContain('dashboardUrl.pathname = "/dashboard"')
    expect(middleware).not.toContain("isOfficialAdminEmail")
    expect(middleware).not.toContain("joshuaduskin@outlook.com")
  })

  it("requires server-side admin authorization on every admin API route", () => {
    const routes = listRouteFiles("app/api/admin")

    expect(routes.length).toBeGreaterThan(0)

    for (const route of routes) {
      const source = read(route)
      if (route === path.join("app/api/admin/me/route.ts")) {
        expect(source).toContain("getAdminStatusFromRequest")
      } else {
        expect(source, route).toContain("requireAdminFromRequest")
      }
    }
  })

  it("keeps the restoration script narrowly scoped to the official account", () => {
    const script = read("scripts/restore-official-admin.mjs")

    expect(script).toContain('const OFFICIAL_ADMIN_EMAIL = "joshuaduskin@outlook.com"')
    expect(script).toContain('role: "admin"')
    expect(script).toContain('.neq("id", authUser.id)')
    expect(script).toContain('role: "merchant"')
    expect(script).toContain('admin.auth.admin.listUsers')
    expect(script).not.toContain("createUser")
    expect(script).not.toContain("generateLink")
    expect(script).not.toContain("updateUserById")
  })

  it("does not let public signup assign an admin role", () => {
    const signup = read("app/signup/page.tsx")
    const login = read("app/login/page.tsx")

    expect(signup).not.toContain("role")
    expect(login).not.toContain("role")
    expect(signup).not.toContain("admin")
    expect(login).not.toContain("admin")
  })
})
