import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const header = read("components/admin/AdminPageHeader.tsx")
const overview = read("app/dashboard/admin/page.tsx")
const transactions = read("app/dashboard/admin/transactions/page.tsx")
const reports = read("app/dashboard/admin/reports/page.tsx")
const filters = read("components/ui/FilterControls.tsx")

const ADMIN_PAGES: Array<[string, string]> = [
  ["overview", overview],
  ["transactions", transactions],
  ["reports", reports],
]

describe("shared admin page header", () => {
  it("orders the surface as page title, then hero card", () => {
    const titleIndex = header.indexOf("dashboardPageTitleClass}>{title}")
    const heroIndex = header.indexOf("{/* Hero card")
    expect(titleIndex).toBeGreaterThan(-1)
    expect(heroIndex).toBeGreaterThan(titleIndex)
  })

  it("carries the command-center eyebrow inside the hero card", () => {
    expect(header).toContain('eyebrow = "Internal Admin Command Center"')
    const hero = header.slice(header.indexOf("{/* Hero card"))
    expect(hero).toContain("dashboardSectionLabelClass}>{eyebrow}")
    // The eyebrow no longer floats above the card.
    const aboveHero = header.slice(header.indexOf("<header"), header.indexOf("{/* Hero card"))
    expect(aboveHero).not.toContain("{eyebrow}")
  })

  it("reuses the Platform Reports hero styling verbatim", () => {
    const hero = header.slice(header.indexOf("{/* Hero card"))
    // Same gradient, radius, border, padding, shadow and top hairline the
    // Reports hero used at its last committed revision.
    expect(hero).toContain("rounded-[1.35rem]")
    expect(hero).toContain("border border-blue-200/80")
    expect(hero).toContain(
      "bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)]"
    )
    expect(hero).toContain("p-5 shadow-[0_18px_60px_rgba(37,99,235,0.13)] sm:p-6")
    expect(hero).toContain("absolute inset-x-6 top-0 h-px bg-gradient-to-r")
  })

  it("keeps Last Updated in the hero card's upper right and stacks it on mobile", () => {
    expect(header).toContain('lastUpdatedLabel = "Last Updated"')
    expect(header).toContain("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between")
    expect(header).toContain("sm:text-right")
    expect(header).toContain("truncate")
  })

  it("renders optional hero metrics inside the same hero card", () => {
    const hero = header.slice(header.indexOf("{/* Hero card"))
    const metricsBlock = hero.slice(hero.indexOf("{metrics &&"))
    expect(metricsBlock).toContain("flex flex-wrap gap-x-10")
    // No second nested card for the metrics.
    expect(metricsBlock).not.toContain("rounded-[1.35rem]")
  })

  it("is used by every admin page instead of a per-page hero", () => {
    for (const [name, source] of ADMIN_PAGES) {
      expect(source, name).toContain("AdminPageHeader")
      expect(source, name).toContain('from "@/components/admin/AdminPageHeader"')
      expect(source, name).not.toContain("Internal Admin Command Center</h1>")
      expect(source, name).not.toContain("PineTree Internal")
      // No leftover bespoke hero card markup.
      expect(source, name).not.toContain("shadow-[0_18px_60px_rgba(37,99,235,0.13)]")
    }
  })

  it("gives each admin page its own specific title", () => {
    expect(overview).toContain('title: "Overview"')
    expect(overview).toContain('title: "Provider Operations"')
    expect(overview).toContain('title: "Support"')
    expect(overview).toContain('title: "Merchant Feedback"')
    expect(transactions).toContain('title="Transaction Explorer"')
    expect(reports).toContain('title="Network Reporting"')
  })

  it("gives each admin tab its own hero-card subtitle", () => {
    expect(overview).toContain(
      "Platform payments, support operations, merchant activity, and platform health."
    )
    expect(overview).toContain(
      "Card and crypto provider onboarding, configuration, merchant connectivity, approval status."
    )
    expect(overview).toContain(
      "Merchant support, ticket management, conversation history, status tracking, and reply workflow."
    )
    expect(overview).toContain(
      "Merchant product feedback, feature requests, experience reports, and improvement suggestions."
    )
  })

  it("keeps the hero card above the existing tab bar and page content", () => {
    const headerIndex = overview.indexOf("<AdminPageHeader")
    const tabsIndex = overview.indexOf("{/* ── Tab bar")
    const contentIndex = overview.indexOf("OVERVIEW TAB")
    expect(headerIndex).toBeGreaterThan(-1)
    expect(tabsIndex).toBeGreaterThan(headerIndex)
    expect(contentIndex).toBeGreaterThan(tabsIndex)
  })

  it("uses one shared refresh control across admin headers", () => {
    for (const [name, source] of ADMIN_PAGES) {
      expect(source, name).toContain("adminHeaderIconButtonClass")
    }
    expect(header).toMatch(/h-11 w-11[\s\S]*sm:h-10 sm:w-10/)
  })
})

describe("admin overview metric condensation", () => {
  it("promotes total payments and confirmed volume into the header region", () => {
    expect(overview).toContain('label: "Total Payments"')
    expect(overview).toContain('label: "Confirmed Volume"')
    expect(overview).toContain("metrics={")
  })

  it("does not repeat the promoted metrics in the card grid", () => {
    const grid = overview.slice(
      overview.indexOf('<DashboardSection title="Payments — All Time'),
      overview.indexOf("Platform Health")
    )
    expect(grid).not.toContain('label="Confirmed Volume"')
    expect(grid).not.toContain('label="Total"')
  })

  it("keeps every canonical lifecycle state as its own tile with the documented tint", () => {
    const grid = overview.slice(
      overview.indexOf('<DashboardSection title="Payments — All Time'),
      overview.indexOf("Platform Health")
    )

    const expected: Array<[string, string]> = [
      ["Confirmed", "green"],
      ["Processing", "blue"],
      ["Waiting", "blue"],
      ["Failed", "red"],
      ["Incomplete", "amber"],
      ["Canceled", "slate"],
      ["Expired", "rose"],
      ["Fees Collected", "blue"],
    ]

    for (const [label, tone] of expected) {
      const tile = grid.slice(grid.indexOf(`label="${label}"`))
      expect(tile.slice(0, 240), label).toContain(`tone="${tone}"`)
    }

    // Expired stays a muted red, visually distinct from Failed.
    expect(read("components/dashboard/DashboardPrimitives.tsx")).toContain(
      'rose: "from-rose-50/70 to-white"'
    )
  })
})

describe("overview recent activity cards", () => {
  it("gives Recent Tickets and Recent Feedback one shared fixed-height card shell", () => {
    expect(overview).toContain("const ADMIN_RECENT_CARD_CLASS")
    expect(overview).toContain("const ADMIN_RECENT_SCROLL_CLASS")
    // Fixed, equal height — the card cannot grow with its content.
    expect(overview).toMatch(/ADMIN_RECENT_CARD_CLASS =\s*\n\s*"flex h-\[20rem\] flex-col overflow-hidden/)
    // The list inside is the scrolling region.
    expect(overview).toMatch(/ADMIN_RECENT_SCROLL_CLASS =\s*\n\s*"min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto/)
  })

  it("applies the shared shell to both cards so heights match", () => {
    const recentSection = overview.slice(
      overview.indexOf("{/* Recent Tickets + Feedback"),
      overview.indexOf("SUPPORT TAB")
    )
    expect(recentSection.match(/ADMIN_RECENT_CARD_CLASS/g)).toHaveLength(2)
    expect(recentSection.match(/ADMIN_RECENT_SCROLL_CLASS/g)).toHaveLength(2)
    // No leftover unbounded card wrapper in this section.
    expect(recentSection).not.toContain("overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-")
  })
})

describe("shared filter control styling", () => {
  it("matches the PineTree-blue pagination interaction treatment", () => {
    const pagination = read("components/ui/PaginationControls.tsx")
    for (const token of ["border-blue-200", "hover:border-blue-300", "focus:ring-blue-50"]) {
      expect(pagination).toContain(token)
      expect(filters).toContain(token)
    }
    // Fields stay light, never solid blue.
    expect(filters).not.toContain("bg-blue-600")
    expect(filters).not.toContain("bg-[#0052FF]")
  })

  it("keeps ~44px touch targets and native selects", () => {
    expect(filters).toContain("h-11")
    expect(filters).toContain("sm:h-10")
    // No appearance-none arrow substitution that breaks mobile pickers. (The
    // phrase appears in the module docs; no exported class may carry it.)
    const exportedClasses = filters
      .split("\n")
      .filter((line) => line.startsWith("export const filter") || line.startsWith("const filterFieldBase"))
      .concat(filters.match(/^\s{2}".*"$/gm) ?? [])
      .join("\n")
    expect(exportedClasses).not.toContain("appearance-none")
  })

  it("styles the Transaction Explorer filters, Apply, Reset and pagination consistently", () => {
    expect(transactions).toContain("filterSearchInputClass")
    expect(transactions).toContain("filterInputClass")
    expect(transactions).toContain("filterSelectClass")
    expect(transactions).toContain("filterResetButtonClass")
    expect(transactions).toContain("filterChipClass")
    expect(transactions).toContain("primaryActionButtonClass")
    expect(transactions).toContain("PaginationControls")
    // Old one-off field styling is gone.
    expect(transactions).not.toContain("const selectCls")
    expect(transactions).not.toContain("focus:ring-[#0052FF]/10")
  })

  it("keeps every Transaction Explorer filter and labels each control", () => {
    for (const id of [
      "admin-tx-search",
      "admin-tx-merchant",
      "admin-tx-status",
      "admin-tx-network",
      "admin-tx-provider",
      "admin-tx-time",
    ]) {
      expect(transactions).toContain(`id="${id}"`)
      expect(transactions).toContain(`htmlFor="${id}"`)
    }
    expect(transactions).toMatch(/>\s*Apply\s*<\/button>/)
  })
})

describe("provider and feedback tab polish", () => {
  it("preserves provider state terminology and never substitutes \"Available\"", () => {
    const providerTab = overview.slice(
      overview.indexOf('{activeTab === "providers" && ('),
      overview.indexOf('{activeTab === "support" && (')
    )
    expect(providerTab).toContain("Approved")
    expect(providerTab).toContain("Denied")
    expect(providerTab).toContain("Pending")
    expect(providerTab).toContain("Enabled")
    expect(providerTab).toContain("Disabled")
    expect(providerTab).not.toContain("Available")
  })

  it("keeps empty states centered and compact rather than a giant blank card", () => {
    const providerTab = overview.slice(
      overview.indexOf('{activeTab === "providers" && ('),
      overview.indexOf('{activeTab === "support" && (')
    )
    expect(providerTab).toContain("flex flex-col items-center justify-center")
    expect(providerTab).not.toContain("py-12")

    const feedbackTab = overview.slice(overview.indexOf("FEEDBACK TAB"))
    expect(feedbackTab).toContain("flex flex-col items-center justify-center")
    expect(feedbackTab).not.toContain("p-12")
  })

  it("keeps tab count badges aligned and consistently styled", () => {
    const tabBar = overview.slice(overview.indexOf("Tab bar"), overview.indexOf("OVERVIEW TAB"))
    expect(tabBar).toContain("inline-flex min-w-5 items-center justify-center rounded-full")
  })

  it("does not invent feedback, provider, or merchant records", () => {
    expect(overview).not.toMatch(/mock(Feedback|Provider|Tickets|Merchants)/i)
    expect(overview).not.toContain("placeholderFeedback")
  })
})
