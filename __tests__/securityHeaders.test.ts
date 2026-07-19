import { describe, expect, it } from "vitest"
import nextConfig from "@/next.config"

describe("production response security", () => {
  it("disables browser source maps and emits safe baseline headers", async () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false)
    expect(nextConfig.headers).toBeTypeOf("function")

    const entries = await nextConfig.headers!()
    const headers = Object.fromEntries(
      entries.flatMap((entry) => entry.headers.map(({ key, value }) => [key, value])),
    )

    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(headers["Permissions-Policy"]).toContain("camera=()")
  })

  it("does not block the documented cross-origin embedded checkout", async () => {
    const entries = await nextConfig.headers!()
    const names = entries.flatMap((entry) => entry.headers.map(({ key }) => key.toLowerCase()))

    expect(names).not.toContain("x-frame-options")
    expect(names).not.toContain("content-security-policy")
  })
})
