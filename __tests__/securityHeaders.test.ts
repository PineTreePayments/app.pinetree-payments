import { describe, expect, it } from "vitest"
import nextConfig from "@/next.config"

/**
 * PineTree serves LAYERED response-security headers:
 *
 *   /:path*                      baseline for every ordinary route
 *   /auth/(confirm|callback)     hardened for password-recovery links, which
 *                                carry a single-use credential in the query
 *                                string
 *
 * These assertions are source-aware on purpose. Flattening every header block
 * into one map would collapse the two policies together and let whichever block
 * happens to be declared last silently define the "baseline" - which is exactly
 * how this test previously reported the recovery-only `no-referrer` as though it
 * were the site-wide policy.
 */

const BASELINE_SOURCE = "/:path*"
const RECOVERY_SOURCE = "/auth/:path(confirm|callback)"

async function headerMapForSource(source: string): Promise<Record<string, string>> {
  const entries = await nextConfig.headers!()
  const entry = entries.find((candidate) => candidate.source === source)
  if (!entry) {
    throw new Error(`No header block is declared for source ${source}`)
  }
  return Object.fromEntries(entry.headers.map(({ key, value }) => [key, value]))
}

describe("production response security", () => {
  it("disables browser source maps and emits safe baseline headers", async () => {
    expect(nextConfig.productionBrowserSourceMaps).toBe(false)
    expect(nextConfig.headers).toBeTypeOf("function")

    const headers = await headerMapForSource(BASELINE_SOURCE)

    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(headers["Permissions-Policy"]).toContain("camera=()")
  })

  it("sends no referrer at all from password-recovery routes", async () => {
    const headers = await headerMapForSource(RECOVERY_SOURCE)

    // A recovery link carries a single-use credential in the query string. A
    // cross-origin referrer would leak it to any third-party asset the page
    // loads, so these routes deliberately strip the referrer entirely rather
    // than using the site-wide strict-origin-when-cross-origin policy.
    expect(headers["Referrer-Policy"]).toBe("no-referrer")
  })

  it("keeps password-recovery responses out of caches and search indexes", async () => {
    const headers = await headerMapForSource(RECOVERY_SOURCE)

    expect(headers["Cache-Control"]).toBe("no-store, private, max-age=0")
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow, noarchive")
  })

  it("does not weaken the recovery policy back to the site-wide default", async () => {
    const baseline = await headerMapForSource(BASELINE_SOURCE)
    const recovery = await headerMapForSource(RECOVERY_SOURCE)

    // Guards the layering itself: the recovery routes must stay strictly
    // stronger than the baseline, not merely different from it.
    expect(baseline["Referrer-Policy"]).not.toBe("no-referrer")
    expect(recovery["Referrer-Policy"]).toBe("no-referrer")
  })

  it("does not block the documented cross-origin embedded checkout", async () => {
    const entries = await nextConfig.headers!()
    const names = entries.flatMap((entry) => entry.headers.map(({ key }) => key.toLowerCase()))

    expect(names).not.toContain("x-frame-options")
    expect(names).not.toContain("content-security-policy")
  })
})
