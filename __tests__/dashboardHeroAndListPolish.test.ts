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

  it("balances the card with an Open Tickets count on the right", () => {
    expect(help).toContain('label: "Open Tickets"')
    expect(help).toContain("openTicketCount")
    // Real count, matching what the page's own "Open" filter selects.
    expect(help).toContain('matchesTicketFilter(ticket, "Open")')
    // No fabricated number while the list is loading or unavailable.
    expect(help).toContain('ticketsLoading || ticketError ? "—" : openTicketCount')
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

describe("hero cards share the component, not the metrics", () => {
  it("offers one optional right-side metric slot on the shared hero card", () => {
    expect(primitives).toContain("export type DashboardHeroMetric")
    expect(primitives).toContain("metric?: DashboardHeroMetric")
    // Splits left/right once there is room; stacks on mobile.
    expect(primitives).toContain("const split = hasValue || Boolean(metric)")
    expect(primitives).toContain('split ? "flex-col sm:flex-row sm:items-end sm:justify-between" : "flex-col"')
    expect(primitives).toContain('sm:text-right')
  })

  it("gives each page the metric that represents that page", () => {
    // Deliberately different per page — only the component is shared.
    expect(help).toContain('label: "Open Tickets"')
    expect(read("app/dashboard/providers/page.tsx")).toContain('label: "Connected Providers"')
    expect(wallet).toContain("Connected Networks")
    const admin = read("app/dashboard/admin/page.tsx")
    expect(admin).toContain('label: "Total Payments"')
    expect(admin).toContain('label: "Confirmed Volume"')
  })

  it("leaves the Inventory hero exactly as it was", () => {
    // Inventory keeps its own four-metric `secondary` row — hero cards are not
    // forced to carry the same information.
    expect(inventory).toContain('eyebrow="INVENTORY OVERVIEW"')
    expect(inventory).toContain('title="Current stock health and value."')
    expect(inventory).toContain("secondary={")
    expect(inventory).toContain('label="Active items"')
    expect(inventory).toContain('label="Low stock"')
    expect(inventory).toContain('label="Out of stock"')
    expect(inventory).toContain('label="Inventory value"')
    // Not converted to the single-metric slot.
    expect(inventory).not.toContain("metric={")
  })

  it("moves the Providers count out from under the description", () => {
    const providers = read("app/dashboard/providers/page.tsx")
    expect(providers).toContain("metric={{")
    expect(providers).toContain("value: connectedAndEnabledProvidersCount")
    // The stacked value/detail pair it replaced is gone.
    expect(providers).not.toContain("value={connectedAndEnabledProvidersCount}")
    expect(providers).not.toContain('detail="Connected Providers"')
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
    // Same scale the Inventory hero renders its value at. Matched with \s+ so
    // the assertion does not depend on the working copy's line endings.
    expect(primitives).toMatch(
      /dashboardHeroValueClass =\s+"text-3xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-4xl"/
    )
  })

  it("carries exactly one metric — Connected Networks — on the right", () => {
    const hero = wallet.slice(
      wallet.indexOf("const connectedRailCount"),
      wallet.indexOf("ariaLabel=\"Wallet workflows\"")
    )
    expect(hero).toContain("sm:justify-between")
    expect(hero).toContain("Connected Networks")
    expect(hero).toContain("{connectedRailCount} / {rows.length}")
    // The lower-value metrics from the previous pass are gone.
    expect(hero).not.toContain("Assets held")
    expect(hero).not.toContain("Needs attention")
    expect(wallet).not.toContain("heldAssetCount")
    expect(wallet).not.toContain("attentionRailCount")
    // Stacks below the balance on smaller screens.
    expect(hero).toContain("flex flex-col gap-5 sm:flex-row")
  })

  it("derives the hero metric from the existing rail rows", () => {
    expect(wallet).toContain("rows.filter((row) => row.configured && row.enabled).length")
    // Nothing fabricated: no hard-coded metric value.
    const hero = wallet.slice(
      wallet.indexOf("const connectedRailCount"),
      wallet.indexOf("ariaLabel=\"Wallet workflows\"")
    )
    expect(hero).not.toMatch(/>\s*\d+\s*\/\s*\d+\s*</)
  })

  it("leaves the balance figure itself untouched", () => {
    // Still the same formatter over the same sync field — presentation only.
    expect(wallet).toContain("formatWalletTotalBalance(sync?.totalUsd, syncing)")
  })
})
