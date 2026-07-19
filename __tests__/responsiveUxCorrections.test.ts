import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("responsive UX corrections", () => {
  it("keeps transaction filters compact with contextual advanced controls", () => {
    const page = read("app/dashboard/transactions/page.tsx")

    expect(page).toContain("advancedFiltersOpen")
    expect(page).toContain("Filter by")
    expect(page).toContain("Apply filters")
    expect(page).toContain("Clear filters")
    expect(page).toContain('type FocusedFilter = "provider" | "network" | "channel" | "method" | "asset" | "date"')
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
  })

  it("scopes terminal viewport locking to the POS route group", () => {
    const rootLayout = read("app/layout.tsx")
    const posLayout = read("app/(pos)/terminal/layout.tsx")
    const terminalInner = read("app/(pos)/terminal/TerminalInnerr.tsx")
    const keypad = read("components/pos/Keypad.tsx")

    expect(rootLayout).not.toContain("userScalable")
    expect(posLayout).toContain("export const viewport")
    expect(posLayout).toContain("maximumScale: 1")
    expect(posLayout).toContain("userScalable: false")
    expect(posLayout).toContain('viewportFit: "cover"')
    expect(terminalInner).toContain("h-[100dvh]")
    expect(terminalInner).toContain("env(safe-area-inset-bottom)")
    expect(keypad).toContain("touch-manipulation")
    expect(keypad).toContain("min-h-12")
  })

  it("uses a reduced-motion-safe blue waiting pulse for pending payments", () => {
    const visual = read("components/payment/PaymentStatusVisual.tsx")
    const css = read("app/globals.css")
    const status = read("lib/utils/paymentStatus.ts")

    expect(status).toContain("text-[#2f5bea]")
    expect(visual).toContain("config.tone === \"waiting\"")
    expect(visual).toContain("pinetree-waiting-indicator")
    expect(css).toContain("@keyframes pinetreeWaitingPulse")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
  })
})
