import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("responsive UX corrections", () => {
  it("keeps transaction filters to compact Network and Time dropdowns", () => {
    const page = read("app/dashboard/transactions/page.tsx")

    expect(page).toContain("baseNetworkFilterOptions")
    expect(page).toContain("All Networks")
    expect(page).toContain("Bitcoin Lightning")
    expect(page).toContain("timeFilterOptions")
    expect(page).toContain("Last Hour")
    expect(page).toContain("All Time")
    expect(page).toContain('aria-label="Network filter"')
    expect(page).toContain('aria-label="Time filter"')
    expect(page).toContain("grid min-w-0 grid-cols-2 gap-2")
    expect(page).not.toContain("advancedFiltersOpen")
    expect(page).not.toContain("Apply filters")
    expect(page).not.toContain("Clear filters")
    expect(page).not.toContain("Status filter")
    expect(page).not.toContain("Status:")
    expect(page).not.toContain("All Wallets")
    expect(page).not.toContain("grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4")
    expect(page).toContain("Complete more transactions to unlock activity insights.")
    expect(page).toContain('authoritativeStatus === "CONFIRMED"')
  })

  it("routes developer management areas to dedicated pages", () => {
    const hub = read("app/dashboard/developer/page.tsx")
    const apiKeys = read("app/dashboard/developer/api-keys/page.tsx")
    const webhooks = read("app/dashboard/developer/webhooks/page.tsx")
    const sdks = read("app/dashboard/developer/sdks/page.tsx")
    const integrations = read("app/dashboard/developer/integrations/page.tsx")
    const guides = read("app/dashboard/developer/guides/page.tsx")

    expect(hub).toContain('href: "/dashboard/developer/api-keys"')
    expect(hub).toContain('href: "/dashboard/developer/webhooks"')
    expect(hub).toContain('href: "/dashboard/developer/sdks"')
    expect(hub).toContain('href: "/dashboard/developer/integrations"')
    expect(hub).not.toContain('aria-pressed={tab === id}')
    expect(apiKeys).toContain('activeSection="developer"')
    expect(apiKeys).toContain("<PublicKeysPanel />")
    expect(webhooks).toContain('activeSection="webhooks"')
    expect(sdks).toContain("npm install @pinetreepayments/node")
    expect(integrations).toContain("<ShopifyIntegrationCard />")
    expect(guides).toContain('DashboardSection title="Quickstart"')
    for (const page of [apiKeys, webhooks, sdks, integrations, guides]) {
      expect(page).not.toContain("Back to Developer")
      expect(page).toContain('href="/dashboard/developer"')
      expect(page).toContain("inline-flex h-10 w-10")
      expect(page).toContain("<X size={18}")
    }
  })

  it("scopes terminal viewport locking to the POS route group", () => {
    const rootLayout = read("app/layout.tsx")
    const posRouteLayout = read("app/(pos)/terminal/layout.tsx")
    const terminalInner = read("app/(pos)/terminal/TerminalInnerr.tsx")
    const keypad = read("components/pos/Keypad.tsx")
    const posLayout = read("components/pos/POSLayout.tsx")

    expect(rootLayout).not.toContain("userScalable")
    expect(posRouteLayout).toContain("export const viewport")
    expect(posLayout).toContain("onLockControlVisibilityChange")
    expect(posLayout).toContain('status === "ready" && paymentMode === null')
    expect(posRouteLayout).toContain("maximumScale: 1")
    expect(posRouteLayout).toContain("userScalable: false")
    expect(posRouteLayout).toContain('viewportFit: "cover"')
    expect(terminalInner).toContain("h-[100dvh]")
    expect(terminalInner).toContain("env(safe-area-inset-bottom)")
    expect(terminalInner).toContain("showUnlockControl")
    expect(keypad).toContain("touch-manipulation")
    expect(keypad).toContain("min-h-12")
  })

  it("uses a reduced-motion-safe blue waiting pulse for pending payments", () => {
    const visual = read("components/payment/PaymentStatusVisual.tsx")
    const css = read("app/globals.css")
    const status = read("lib/utils/paymentStatus.ts")

    expect(status).toContain("text-[#2f5bea]")
    expect(status).toContain('iconBgClassName: "bg-transparent"')
    expect(visual).toContain("config.tone === \"waiting\"")
    expect(visual).toContain("pinetree-waiting-indicator")
    expect(visual).toContain('${isWaiting ? "pinetree-waiting-indicator" : ""}')
    expect(css).toContain("@keyframes pinetreeWaitingPulse")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
  })
})
