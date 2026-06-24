import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

// ─── Hook source ──────────────────────────────────────────────────────────────

describe("useDashboardAutoRefresh hook", () => {
  const hook = read("hooks/useDashboardAutoRefresh.ts")

  it("exports useDashboardAutoRefresh", () => {
    expect(hook).toContain("export function useDashboardAutoRefresh")
  })

  it("exports UseDashboardAutoRefreshOptions interface", () => {
    expect(hook).toContain("export interface UseDashboardAutoRefreshOptions")
  })

  it("refreshes on mount via a dedicated useEffect with empty dependency array", () => {
    // The mount effect must not depend on any changing value so it runs on
    // every component mount (every page navigation), not just on first render.
    expect(hook).toContain("}, [])")
  })

  it("listens for visibilitychange to refresh when tab becomes visible", () => {
    expect(hook).toContain("visibilitychange")
    expect(hook).toContain("visibilityState")
    expect(hook).toContain('"visible"')
  })

  it("listens for window focus to refresh when window regains focus", () => {
    expect(hook).toContain('"focus"')
    expect(hook).toContain("window.addEventListener")
  })

  it("throttles visibility/focus refreshes with minIntervalMs", () => {
    expect(hook).toContain("minIntervalMs")
    expect(hook).toContain("lastThrottledAtRef")
    // Throttle guard: bail out if not enough time has passed
    expect(hook).toContain("< minIntervalMs")
  })

  it("prevents concurrent refreshes with a pending flag", () => {
    expect(hook).toContain("pendingRef")
    expect(hook).toContain("pendingRef.current = true")
    expect(hook).toContain("pendingRef.current = false")
  })

  it("skips visibility/focus refresh while another refresh is pending", () => {
    expect(hook).toContain("if (pendingRef.current) return")
  })

  it("keeps the refresh callback current via a ref to avoid stale closures", () => {
    expect(hook).toContain("refreshRef.current = refresh")
  })

  it("cleans up event listeners on unmount", () => {
    expect(hook).toContain("removeEventListener")
    expect(hook).toContain("return () => {")
  })

  it("defaults: mount=true, visibility=true, focus=true, interval=60000", () => {
    expect(hook).toContain("refreshOnMount = true")
    expect(hook).toContain("refreshOnVisibility = true")
    expect(hook).toContain("refreshOnFocus = true")
    expect(hook).toContain("60_000")
  })

  it("guards against SSR by checking typeof window", () => {
    expect(hook).toContain('typeof window === "undefined"')
  })
})

// ─── Wallets page (now a redirect to /dashboard/wallet-setup) ────────────────

describe("Wallets page redirect", () => {
  const wallets = read("app/dashboard/wallets/page.tsx")

  it("redirects to /dashboard/wallet-setup (wallet experience unified)", () => {
    expect(wallets).toContain('redirect("/dashboard/wallet-setup")')
  })

  it("is a server component — no use client directive", () => {
    expect(wallets).not.toContain('"use client"')
  })
})

// ─── Overview page ────────────────────────────────────────────────────────────

describe("Overview page auto-refresh", () => {
  const overview = read("app/dashboard/page.tsx")

  it("imports useDashboardAutoRefresh", () => {
    expect(overview).toContain("useDashboardAutoRefresh")
    expect(overview).toContain("@/hooks/useDashboardAutoRefresh")
  })

  it("uses refreshOnMount: false (mount is already handled by existing useEffect)", () => {
    expect(overview).toContain("refreshOnMount: false")
  })

  it("does not show a manual Sync Now button (auto-refresh handles it)", () => {
    expect(overview).not.toContain("Sync Now")
    expect(overview).not.toContain("syncNow")
    expect(overview).not.toContain("isSyncing")
    expect(overview).not.toContain("syncError")
  })

  it("loads data on mount via its own useEffect (unchanged)", () => {
    expect(overview).toContain("void loadOverview()")
  })
})

// ─── Transactions page ────────────────────────────────────────────────────────

describe("Transactions page auto-refresh", () => {
  const transactions = read("app/dashboard/transactions/page.tsx")

  it("imports useDashboardAutoRefresh", () => {
    expect(transactions).toContain("useDashboardAutoRefresh")
    expect(transactions).toContain("@/hooks/useDashboardAutoRefresh")
  })

  it("uses refreshOnMount: false (existing useEffect handles mount)", () => {
    expect(transactions).toContain("refreshOnMount: false")
  })

  it("wires the refresh to loadDashboardData", () => {
    expect(transactions).toContain("refresh: loadDashboardData")
  })
})

// ─── Reports page ─────────────────────────────────────────────────────────────

describe("Reports page auto-refresh", () => {
  const reports = read("app/dashboard/reports/page.tsx")

  it("imports useDashboardAutoRefresh", () => {
    expect(reports).toContain("useDashboardAutoRefresh")
    expect(reports).toContain("@/hooks/useDashboardAutoRefresh")
  })

  it("uses refreshOnMount: false (existing useEffect handles mount)", () => {
    expect(reports).toContain("refreshOnMount: false")
  })

  it("wires the refresh to fetchSummary", () => {
    expect(reports).toContain("refresh: fetchSummary")
  })
})

// ─── Providers page ───────────────────────────────────────────────────────────

describe("Providers page auto-refresh", () => {
  const providers = read("app/dashboard/providers/page.tsx")

  it("imports useDashboardAutoRefresh", () => {
    expect(providers).toContain("useDashboardAutoRefresh")
    expect(providers).toContain("@/hooks/useDashboardAutoRefresh")
  })

  it("uses refreshOnMount: false (existing useEffect handles mount)", () => {
    expect(providers).toContain("refreshOnMount: false")
  })

  it("wires the refresh to loadAll", () => {
    expect(providers).toContain("refresh: loadAll")
  })
})

// ─── Sidebar scrollbar polish ─────────────────────────────────────────────────

describe("sidebar scrollbar styling", () => {
  it("layout applies pinetree-sidebar-nav class to the scrollable nav element", () => {
    const layout = read("app/dashboard/layout.tsx")
    expect(layout).toContain("pinetree-sidebar-nav")
    expect(layout).toContain("overflow-y-auto")
  })

  it("globals.css defines WebKit scrollbar styles for pinetree-sidebar-nav", () => {
    const css = read("app/globals.css")
    expect(css).toContain(".pinetree-sidebar-nav")
    expect(css).toContain("::-webkit-scrollbar")
    expect(css).toContain("::-webkit-scrollbar-track")
    expect(css).toContain("::-webkit-scrollbar-thumb")
    expect(css).toContain("border-radius: 999px")
  })

  it("globals.css includes Firefox scrollbar-width and scrollbar-color fallback", () => {
    const css = read("app/globals.css")
    expect(css).toContain("scrollbar-width: thin")
    expect(css).toContain("scrollbar-color")
  })

  it("globals.css sets a transparent scrollbar track (no chunky background)", () => {
    const css = read("app/globals.css")
    // Track must be transparent
    const trackBlock = css.slice(
      css.indexOf("::-webkit-scrollbar-track"),
      css.indexOf("::-webkit-scrollbar-thumb")
    )
    expect(trackBlock).toContain("transparent")
  })

  it("globals.css thumb has a hover state for discoverability", () => {
    const css = read("app/globals.css")
    expect(css).toContain("::-webkit-scrollbar-thumb:hover")
  })

  it("scrollbar styles are scoped to .pinetree-sidebar-nav, not the global body", () => {
    const css = read("app/globals.css")
    // The body rule must not contain scrollbar overrides
    const bodyBlock = css.slice(css.indexOf("body {"), css.indexOf("body.pinetree-modal-open"))
    expect(bodyBlock).not.toContain("scrollbar")
  })
})

// ─── Cross-cutting safety checks ──────────────────────────────────────────────

describe("dashboard pages: no raw internal errors exposed", () => {
  const pages = [
    "app/dashboard/page.tsx",
    "app/dashboard/wallets/page.tsx",
    "app/dashboard/transactions/page.tsx",
    "app/dashboard/reports/page.tsx",
    "app/dashboard/providers/page.tsx",
  ]

  for (const p of pages) {
    it(`${p} does not expose raw Error stack traces to merchants`, () => {
      const src = read(p)
      expect(src).not.toContain("error.stack")
      expect(src).not.toContain(".stack")
    })
  }
})
