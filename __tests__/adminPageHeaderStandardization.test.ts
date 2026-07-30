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
  it("carries the command-center eyebrow above the page title, not inside a card", () => {
    expect(header).toContain('eyebrow = "Internal Admin Command Center"')
    expect(header).toContain("dashboardSectionLabelClass")
    expect(header).toContain("dashboardPageTitleClass")
    // The title is a plain page header like the merchant dashboard pages, not a
    // full-bleed hero card.
    const titleBlock = header.slice(header.indexOf("<header"), header.indexOf("{metrics &&"))
    expect(titleBlock).not.toContain("shadow-[0_18px_60px")
    expect(titleBlock).not.toContain("rounded-[1.35rem]")
  })

  it("aligns Last Updated with the title row and stacks it on mobile", () => {
    expect(header).toContain('lastUpdatedLabel = "Last Updated"')
    expect(header).toContain("flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between")
    expect(header).toContain("sm:text-right")
    expect(header).toContain("truncate")
  })

  it("keeps the white/glass floating treatment for the optional hero metrics only", () => {
    const metricsBlock = header.slice(header.indexOf("{metrics &&"))
    expect(metricsBlock).toContain("border-blue-200/80")
    expect(metricsBlock).toContain("rounded-2xl")
    expect(metricsBlock).toContain("sm:grid-cols-2")
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
