import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

// Next.js/webpack inlines NEXT_PUBLIC_* values by statically matching the
// literal expression `process.env.NEXT_PUBLIC_X` wherever it appears in
// source. Calling getPineTreeDynamicAuthConfig() with no argument relies on
// its `= process.env` default param, which is NOT a literal per-key access
// and is never inlined into the client bundle — it silently resolves to
// "missing" in production regardless of what's set in Vercel. Client call
// sites must always pass an explicit object built from literal
// `process.env.NEXT_PUBLIC_...` reads at the call site.
describe("PineTree Dynamic auth client env inlining", () => {
  const clientFiles = ["components/providers/PineTreeDynamicProvider.tsx", "app/dashboard/wallet-setup/page.tsx"]

  it("never calls getPineTreeDynamicAuthConfig() with no arguments in client code", () => {
    for (const file of clientFiles) {
      const source = read(file)
      expect(source).not.toMatch(/getPineTreeDynamicAuthConfig\(\)/)
    }
  })

  it("reads both PineTree Dynamic auth vars via literal process.env member expressions", () => {
    for (const file of clientFiles) {
      const source = read(file)
      expect(source).toContain("process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE")
      expect(source).toContain("process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK")
    }
  })
})
