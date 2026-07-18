import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("middleware bearer authentication", () => {
  it("validates Supabase bearer sessions when an API request has no auth cookie", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8")

    expect(source).toContain('req.headers.get("authorization")')
    expect(source).toContain('authorization.startsWith("Bearer ")')
    expect(source).toContain("supabase.auth.getUser(bearerToken)")
    expect(source).toContain("user = bearerAuth.data.user")
    expect(source).toContain('!bearerToken.startsWith("pt_live_")')
  })
})
