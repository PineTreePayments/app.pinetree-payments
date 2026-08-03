import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const table = read("components/admin/AdminMetricTable.tsx")
const reports = read("app/dashboard/admin/reports/page.tsx")
const closeButton = read("components/ui/ModalCloseButton.tsx")
const detailPanel = read("components/admin/TransactionDetail/AdminTransactionDetailPanel.tsx")

/** The desktop table markup: everything the `sm:` rendering owns. */
const desktopRegion = table.slice(
  table.indexOf("{/* Desktop header */}"),
  table.indexOf("{/* Mobile:")
)

/** The collapsed mobile row control. */
const mobileRow = table.slice(
  table.indexOf("{/* Mobile:"),
  table.indexOf("Rendered as a sibling of the card")
)

/** The mobile detail panel component. */
const panel = table.slice(
  table.indexOf("function AdminMetricDetailPanel"),
  table.indexOf("// ─── Table ")
)

describe("desktop metric table is unchanged", () => {
  it("still renders every column in the full table at sm and up", () => {
    // Header and body rows are both `sm:grid`, driven by one template string.
    expect(desktopRegion).toContain('className="hidden gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid"')
    expect(desktopRegion).toContain('className="hidden items-center gap-4 px-5 py-3 sm:grid"')
    expect(desktopRegion.match(/style=\{\{ gridTemplateColumns \}\}/g)).toHaveLength(2)

    // Every column renders on desktop — no summarising there.
    expect(desktopRegion.match(/columns\.map/g)).toHaveLength(2)
    expect(desktopRegion).toContain("column.render(row)")
    expect(desktopRegion).toContain("text-right tabular-nums")
    expect(desktopRegion).not.toContain("summaryColumn")
  })

  it("keeps shared column widths and adds no desktop expandable behaviour", () => {
    expect(table).toContain(
      'const gridTemplateColumns = [`minmax(0, 1fr)`, ...columns.map((column) => column.width)].join(" ")'
    )
    // The row control and the panel are both scoped below sm.
    expect(mobileRow).toContain("sm:hidden")
    expect(table).toContain('const DESKTOP_MEDIA_QUERY = "(min-width: 640px)"')
  })
})

describe("mobile uses compact expandable rows", () => {
  it("shows only the row name, summary metric and an expand indicator", () => {
    expect(mobileRow).toContain("rowLabel(row, index)")
    expect(mobileRow).toContain("summaryColumn.render(row)")
    expect(mobileRow).toContain("ChevronRight")

    // The collapsed row must not enumerate the remaining metrics.
    expect(mobileRow).not.toContain("columns.map")
    expect(mobileRow).not.toContain("column.header")
    expect(mobileRow).not.toContain("<dl")
  })

  it("replaces the old per-row metric grid entirely", () => {
    // The previous mobile rendering listed every metric with its own label.
    expect(table).not.toContain('<dt className="truncate text-[11px] font-semibold uppercase')
    expect(table).not.toContain("mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5")
  })

  it("keeps rows compact enough that several fit on a phone", () => {
    // ~56px minimum with no oversized padding or nested cards.
    expect(mobileRow).toContain("min-h-[3.5rem]")
    expect(mobileRow).toContain("px-4 py-3")
    expect(mobileRow).not.toMatch(/py-[5-9]/)
    expect(mobileRow).not.toContain("rounded-2xl")
  })

  it("makes the whole row one accessible control with visible states", () => {
    expect(mobileRow).toContain("<button")
    expect(mobileRow).toContain('type="button"')
    expect(mobileRow).toContain('aria-haspopup="dialog"')
    expect(mobileRow).toContain("aria-expanded={isOpen}")
    expect(mobileRow).toContain("aria-controls={isOpen ? panelId : undefined}")
    // Hover, focus and pressed feedback.
    expect(mobileRow).toContain("hover:bg-[#0052FF]/[0.04]")
    expect(mobileRow).toContain("focus-visible:ring-4")
    expect(mobileRow).toContain("active:bg-[#0052FF]/[0.08]")
  })

  it("does not reintroduce horizontal overflow", () => {
    expect(mobileRow).toContain("w-full min-w-0")
    expect(mobileRow).toContain("truncate")
    expect(panel).toContain("overflow-x-hidden")
    expect(table).toContain('className="min-w-0 overflow-hidden rounded-2xl')
  })
})

describe("mobile detail panel", () => {
  it("shows the secondary metrics the collapsed row omits", () => {
    expect(panel).toContain("columns.map")
    expect(panel).toContain("detailLabel(column)")
    expect(panel).toContain("column.render(row)")
    expect(table).toContain("return column.detailHeader ?? column.header")

    // The report supplies the spelled-out labels for all five metrics.
    for (const label of [
      "Total payments",
      "Confirmed payments",
      "Confirmed volume",
      "Platform fees",
      "Conversion rate",
    ]) {
      expect(reports, label).toContain(`detailHeader: "${label}"`)
    }
  })

  it("reuses the standard PineTree modal shell and circular X button", () => {
    expect(table).toContain('from "@/components/ui/ModalCloseButton"')
    expect(panel).toContain("className={modalCloseButtonClass}")
    expect(panel).toContain("<X size={18}")
    expect(panel).toContain("pinetree-modal-backdrop fixed inset-0")
    expect(panel).toContain('data-pinetree-overlay="true"')

    // Same close-button atom the transaction panel uses — not a forked X.
    expect(detailPanel).toContain("className={modalCloseButtonClass}")
    expect(closeButton).toContain("export const modalCloseButtonClass")
  })

  it("closes on X, backdrop and Escape, and traps focus", () => {
    expect(panel).toContain("onClick={onClose}")
    expect(panel).toContain("onMouseDown={onClose}")
    expect(panel).toContain("onMouseDown={(event) => event.stopPropagation()}")
    expect(panel).toContain('if (event.key === "Escape")')
    expect(panel).toContain('if (event.key !== "Tab") return')
    expect(panel).toContain("returnFocusRef.current?.focus?.()")
  })

  it("carries dialog semantics and scrolls its own content", () => {
    expect(panel).toContain('role="dialog"')
    expect(panel).toContain('aria-modal="true"')
    expect(panel).toContain("aria-labelledby={titleId}")
    expect(panel).toContain('aria-label="Close details"')
    // Bounded with dvh so mobile browser chrome cannot hide the content.
    expect(panel).toContain("max-h-[85dvh]")
    expect(panel).toContain("overflow-y-auto")
  })

  it("prevents background scrolling while open and restores it after", () => {
    expect(panel).toContain("const previousOverflow = document.body.style.overflow")
    expect(panel).toContain('document.body.style.overflow = "hidden"')
    expect(panel).toContain("document.body.style.overflow = previousOverflow")
  })

  it("keeps exactly one panel open at a time", () => {
    // A single key, not a set of expanded rows.
    expect(table).toContain("const [openKey, setOpenKey] = useState<string | null>(null)")
    expect(table).toContain("const isOpen = openKey === key")
    expect(table).not.toContain("useState<Set<")
  })

  it("opens in place without navigating away from Reports", () => {
    expect(table).not.toContain("useRouter")
    expect(table).not.toContain("next/link")
    expect(table).not.toContain("href=")
  })
})

describe("one shared implementation", () => {
  it("is the only metric-table implementation the report page uses", () => {
    expect(reports.match(/<AdminMetricTable/g)).toHaveLength(3)
    // Rail and Provider are the same component with the same columns.
    expect(reports.match(/columns=\{VOLUME_COLUMNS\}/g)).toHaveLength(2)
    expect(reports).toContain('leadingLabel="Rail"')
    expect(reports).toContain('leadingLabel="Provider"')
  })

  it("keeps no mobile markup or duplicate formatting in the report page", () => {
    expect(reports).not.toContain("sm:hidden")
    expect(reports).not.toContain("pinetree-modal-backdrop")
    expect(reports).not.toContain("modalCloseButtonClass")
    expect(reports).not.toContain("aria-haspopup")
    // One column definition drives both breakpoints and both tables.
    expect(reports.match(/const VOLUME_COLUMNS/g)).toHaveLength(1)
  })

  it("computes nothing in the presentation layer", () => {
    // Totals, fees, conversion and ordering all arrive already decided.
    for (const forbidden of ["reduce(", "Math.round", ".sort("]) {
      expect(table, forbidden).not.toContain(forbidden)
    }
  })
})
