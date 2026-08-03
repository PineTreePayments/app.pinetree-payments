import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  projectCanonicalTransaction,
  resolveCanonicalPaymentSource,
} from "@/engine/canonicalTransactions"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const panel = read("components/admin/TransactionDetail/AdminTransactionDetailPanel.tsx")
const format = read("components/admin/TransactionDetail/format.ts")
const hook = read("components/admin/TransactionDetail/useAdminTransactionDetail.ts")
const overview = read("app/dashboard/admin/page.tsx")
const explorer = read("app/dashboard/admin/transactions/page.tsx")
const reports = read("app/dashboard/admin/reports/page.tsx")
const metricTable = read("components/admin/AdminMetricTable.tsx")
const merchantActivity = read("app/dashboard/TransactionActivityTable.tsx")

const ADMIN_PAGES: Array<[string, string]> = [
  ["overview", overview],
  ["transactions", explorer],
  ["reports", reports],
]

describe("one canonical Admin Transaction Detail component", () => {
  it("is the only transaction-detail panel rendered anywhere in Admin", () => {
    for (const [name, source] of ADMIN_PAGES) {
      // No page owns drawer chrome of its own any more.
      expect(source, name).not.toContain("Platform Transaction Detail")
      expect(source, name).not.toContain('aria-label="Close transaction detail"')
    }
    expect(panel).toContain("Platform Transaction Detail")

    // Both entry points render the same import from the same barrel.
    for (const [name, source] of [["overview", overview], ["transactions", explorer]] as const) {
      expect(source, name).toContain("AdminTransactionDetailPanel")
      expect(source, name).toContain('from "@/components/admin/TransactionDetail"')
      expect(source, name).toContain("useAdminTransactionDetail()")
    }
  })

  it("leaves no duplicated transaction field mapping on the admin pages", () => {
    for (const [name, source] of [["overview", overview], ["transactions", explorer]] as const) {
      for (const helper of [
        "function detailPaymentId",
        "function detailStatus",
        "function detailGrossAmount",
        "function detailMerchantAmount",
        "function detailFeeAmount",
        "function detailReference",
        "function extractMeta",
        "function extractEventPayload",
        "const EVENT_LABELS",
      ]) {
        expect(source, `${name}: ${helper}`).not.toContain(helper)
      }
    }

    // The mapping lives in exactly one module.
    expect(format).toContain("export function adminPaymentGrossMinor")
    expect(format).toContain("export function adminEventPayload")
    expect(format).toContain("const EVENT_LABELS")
  })

  it("loads every admin transaction through one fetch path", () => {
    expect(hook).toContain("/api/admin/transactions/")
    for (const [name, source] of [["overview", overview], ["transactions", explorer]] as const) {
      expect(source, name).not.toContain("/api/admin/transactions/${encodeURIComponent")
    }
  })

  it("supports optional sections without forking the component", () => {
    for (const flag of [
      "showTimeline",
      "showWatcherEvents",
      "showDiagnostics",
      "showProviderMetadata",
    ]) {
      expect(panel).toContain(flag)
    }
    expect(read("components/admin/TransactionDetail/types.ts")).toContain(
      "ADMIN_TRANSACTION_DETAIL_SECTION_DEFAULTS"
    )
  })

  it("keeps the internal support sections the admin drawer exists for", () => {
    for (const section of [
      "Payment Timeline",
      "Watcher Detection",
      "Processing History",
      "Admin Diagnostics",
      "Wallet &amp; Routing",
      "Reference / Hash",
    ]) {
      expect(panel).toContain(section)
    }
  })

  it("leaves the merchant-facing transaction view simplified", () => {
    // Merchant surfaces must not pick up admin internals.
    expect(merchantActivity).not.toContain("AdminTransactionDetailPanel")
    for (const adminOnly of ["Payment Timeline", "Watcher Detection", "Admin Diagnostics"]) {
      expect(merchantActivity, adminOnly).not.toContain(adminOnly)
    }
  })
})

describe("payment source badge", () => {
  it("comes from the canonical record rather than UI inference", () => {
    expect(resolveCanonicalPaymentSource("pos")).toEqual({ key: "terminal", label: "Terminal" })
    expect(resolveCanonicalPaymentSource("online")).toEqual({
      key: "online",
      label: "Online Checkout",
    })
    expect(resolveCanonicalPaymentSource("api").label).toBe("API")
    expect(resolveCanonicalPaymentSource("invoice").label).toBe("Invoice")
    // An untagged legacy row is not guessed into a channel.
    expect(resolveCanonicalPaymentSource(null)).toEqual({
      key: "unknown",
      label: "Unknown source",
    })
  })

  it("is projected onto the canonical transaction from the stored channel", () => {
    const projected = projectCanonicalTransaction({
      id: "payment-1",
      merchant_id: "merchant-1",
      status: "CONFIRMED",
      provider: "base",
      network: "base",
      currency: "USD",
      gross_amount: 10,
      created_at: new Date().toISOString(),
      transactions: [{ id: "attempt-1", channel: "pos", status: "CONFIRMED" }],
    })
    expect(projected.paymentSource).toEqual({ key: "terminal", label: "Terminal" })
  })

  it("renders the source pill beside the status badge and drops the Live badge", () => {
    expect(panel).toContain("adminPaymentSourceLabel(payment)")
    expect(panel).toContain("adminSourcePillClass")
    // Read off the canonical record; never re-derived from channel/metadata.
    expect(format).toContain("payment.paymentSource?.label")
    expect(panel).not.toContain('=== "pos"')
    // The Live badge's styling inverted into PineTree blue.
    expect(panel).toContain("border-blue-200 bg-blue-50 text-blue-700")

    // The badge row carries status + source only: no Live badge, and no
    // lifecycle Terminal/Non-terminal pill to collide with "Terminal".
    const badgeRow = panel.slice(
      panel.indexOf("Status, payment source and amounts"),
      panel.indexOf("Core Details")
    )
    expect(badgeRow).toContain("PaymentStatusBadge")
    expect(badgeRow).not.toContain('"Live"')
    expect(badgeRow).not.toContain("Non-terminal")
    expect(panel).not.toContain("TERMINAL_STATUSES")
    expect(explorer).not.toContain("TERMINAL_STATUSES")
  })
})

describe("admin mobile layout contracts", () => {
  it("keeps the Overview recent cards inside the viewport with no sideways scroll", () => {
    expect(overview).toMatch(/ADMIN_RECENT_CARD_CLASS =[\s\S]{0,220}min-w-0/)
    expect(overview).toMatch(/ADMIN_RECENT_SCROLL_CLASS =[\s\S]{0,200}overflow-x-hidden/)
    // Each grid child is allowed to shrink below its content's min-content size.
    const recentSection = overview.slice(
      overview.indexOf("{/* Recent Tickets + Feedback"),
      overview.indexOf("SUPPORT TAB")
    )
    expect(recentSection.match(/className="min-w-0"/g)).toHaveLength(2)
  })

  it("breaks merchant-authored text so one long token cannot widen a card", () => {
    // Feedback message renders in two places; both must wrap.
    expect(overview).toContain("line-clamp-1 break-words")
    expect(overview).toContain("whitespace-pre-wrap break-words")
  })

  it("right-aligns report numerics through one shared table", () => {
    expect(metricTable).toContain("text-right tabular-nums")
    expect(metricTable).toContain("gridTemplateColumns")
    // Header and rows are driven by the same template string.
    expect(metricTable.match(/style=\{\{ gridTemplateColumns \}\}/g)).toHaveLength(2)

    // The report page no longer declares per-table pixel grids that applied at
    // every breakpoint (the source of the mobile zig-zag and clipping).
    expect(reports).not.toContain("grid-cols-[1fr_90px_90px_110px_100px_80px]")
    expect(reports).not.toContain("grid-cols-[1fr_100px_120px]")
    expect(reports).toContain("AdminMetricTable")
    // Rail and Provider tables share one column definition, so widths match.
    expect(reports).toContain("const VOLUME_COLUMNS")
    expect(reports.match(/columns=\{VOLUME_COLUMNS\}/g)).toHaveLength(2)
  })
})
