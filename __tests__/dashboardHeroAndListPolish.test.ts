import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const help = read("app/dashboard/help/page.tsx")
const wallet = read("app/dashboard/wallet-setup/page.tsx")
const inventory = read("app/dashboard/inventory/page.tsx")
const primitives = read("components/dashboard/DashboardPrimitives.tsx")

describe("Help Center hero card", () => {
  it("uses the shared dashboard hero card, like Inventory and the admin pages", () => {
    expect(help).toContain("DashboardHeroCard")
    expect(help).toContain('from "@/components/dashboard/DashboardPrimitives"')
    // Same component the other dashboard pages use — no forked hero markup.
    expect(help).not.toContain("shadow-[0_18px_60px_rgba(37,99,235,0.13)]")
    expect(inventory).toContain("DashboardHeroCard")
  })

  it("carries the Help Center eyebrow and description", () => {
    expect(help).toContain('eyebrow="HELP CENTER"')
    expect(help).toContain(
      "Documentation, AI assistance, support resources, troubleshooting guides, and merchant help tools."
    )
  })

  it("sits directly beneath the page title", () => {
    const titleIndex = help.indexOf("dashboardPageTitleClass}>Help Center")
    const heroIndex = help.indexOf("<DashboardHeroCard")
    const navIndex = help.indexOf("HELP_NAV_ITEMS.map")
    expect(titleIndex).toBeGreaterThan(-1)
    expect(heroIndex).toBeGreaterThan(titleIndex)
    expect(navIndex).toBeGreaterThan(heroIndex)
  })
})

describe("Help Center layout cleanup", () => {
  it("removes the duplicate Support Paths section and its data", () => {
    expect(help).not.toContain("Support Paths")
    expect(help).not.toContain("supportHubSections")
    expect(help).not.toContain("supportHubCards")
  })

  it("keeps Support and Recent Tickets as identical fixed-height panels", () => {
    expect(help).toContain("const SUPPORT_PANEL_CLASS")
    expect(help).toContain("const SUPPORT_PANEL_SCROLL_CLASS")
    expect(help).toMatch(/SUPPORT_PANEL_CLASS =\s*\n\s*"flex h-\[34rem\] flex-col overflow-hidden/)
    expect(help).toMatch(/SUPPORT_PANEL_SCROLL_CLASS = "min-h-0 flex-1 overflow-y-auto/)

    // Both panels use the same shell and the same internal scroll region, so
    // their heights cannot diverge with ticket count.
    expect(help.match(/className=\{SUPPORT_PANEL_CLASS\}/g)).toHaveLength(2)
    expect(help.match(/SUPPORT_PANEL_SCROLL_CLASS\}/g)).toHaveLength(2)

    // items-start would let the shorter panel shrink; it is gone.
    expect(help).not.toContain("grid items-start gap-4 min-[1180px]")
  })

  it("pins the panel chrome so only the inner region scrolls", () => {
    // Ticket form header and submit row, plus the tickets header and filters.
    expect(help.match(/flex-none/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })
})

describe("Recent ticket metadata", () => {
  it("drops the support category from ticket rows", () => {
    const desktopRows = help.slice(
      help.indexOf('id="recent-tickets"'),
      help.indexOf('<DashboardSection title="Feedback"')
    )
    expect(desktopRows).not.toContain("formatSupportCategory")
    expect(desktopRows).toContain("formatTicketPriorityLabel(ticket.priority)")
    expect(desktopRows).toContain("TicketStatusPill")
    expect(desktopRows).toContain("formatDate(ticket.created_at)")
  })

  it("labels priority rather than printing a bare enum", () => {
    expect(help).toContain("function formatTicketPriorityLabel")
    expect(help).toContain("`${formatSupportPriority(priority)} Priority`")
  })

  it("drops the category from the mobile ticket list too", () => {
    const mobileRows = help.slice(
      help.indexOf('{mobileSection === "tickets" && ('),
      help.indexOf("DESKTOP ONLY")
    )
    expect(mobileRows).toContain("formatTicketPriorityLabel(ticket.priority)")
    expect(mobileRows).not.toContain("formatSupportCategory")
  })
})

describe("Wallet hero card", () => {
  it("uses the shared hero value scale instead of an oversized custom size", () => {
    expect(wallet).toContain("dashboardHeroValueClass")
    expect(wallet).not.toContain("text-[2.35rem] font-semibold leading-none tracking-normal")
    expect(wallet).not.toContain("sm:text-5xl")
    // Same scale the Inventory hero renders its value at.
    expect(primitives).toContain(
      'dashboardHeroValueClass =\n  "text-3xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-4xl"'
    )
  })

  it("fills the empty right half on desktop with a metric row", () => {
    const hero = wallet.slice(
      wallet.indexOf("const connectedRailCount"),
      wallet.indexOf("ariaLabel=\"Wallet workflows\"")
    )
    expect(hero).toContain("lg:flex-row")
    expect(hero).toContain("lg:justify-between")
    expect(hero).toContain("InlineMetric")
    expect(hero).toContain("Connected networks")
    expect(hero).toContain("Assets held")
    expect(hero).toContain("Needs attention")
    // Stacks below the balance on smaller screens.
    expect(hero).toContain("flex flex-col gap-5 lg:flex-row")
  })

  it("derives every hero metric from the existing sync payload and rail rows", () => {
    expect(wallet).toContain("rows.filter((row) => row.configured && row.enabled).length")
    expect(wallet).toContain("rows.filter((row) => Boolean(row.needsAttentionMessage)).length")
    expect(wallet).toContain("...sync.balances.base, ...sync.balances.solana, ...sync.balances.bitcoin")
    // Nothing fabricated: no placeholder or hard-coded metric values.
    const hero = wallet.slice(
      wallet.indexOf("const connectedRailCount"),
      wallet.indexOf("ariaLabel=\"Wallet workflows\"")
    )
    expect(hero).not.toMatch(/value=\{?["'`]?\d+["'`]?\}/)
  })

  it("shows an em dash for assets held until the first sync lands", () => {
    expect(wallet).toContain('value={hasSyncedOnce ? heldAssetCount : "—"}')
  })

  it("leaves the balance figure itself untouched", () => {
    // Still the same formatter over the same sync field — presentation only.
    expect(wallet).toContain("formatWalletTotalBalance(sync?.totalUsd, syncing)")
  })
})
