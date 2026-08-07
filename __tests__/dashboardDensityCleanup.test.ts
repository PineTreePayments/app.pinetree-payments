/**
 * Dashboard density and grouping pass.
 *
 * Presentation only. Nothing here asserts a payment, provider, wallet,
 * reporting, or verification decision — those live in the Engine and are
 * covered by their own suites. These tests pin the layout decisions so a later
 * change cannot quietly reintroduce the oversized cards, the per-status card
 * grid, or the truncated status label.
 *
 * Source-text assertions are used deliberately: these are layout contracts in
 * markup, and a pixel snapshot would be brittle without proving more.
 */

import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

/** Drops comments so prose in a docstring cannot satisfy an assertion. */
function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
}

const admin = read("app/dashboard/admin/page.tsx")
const operatorSection = read("components/admin/Shift4SandboxOperationsSection.tsx")
const operatorCode = stripComments(operatorSection)
const transactions = read("app/dashboard/transactions/page.tsx")
const reports = read("app/dashboard/reports/page.tsx")
const reportsCode = stripComments(reports)
const wallet = read("app/dashboard/wallet-setup/page.tsx")
const profileWarning = read("components/dashboard/BusinessProfileWarning.tsx")
const requirementBanner = read("components/dashboard/BusinessProfileRequirementBanner.tsx")
const settings = read("app/dashboard/settings/page.tsx")
const dashboardLayout = read("app/dashboard/layout.tsx")
const providers = read("app/dashboard/providers/page.tsx")
const help = read("app/dashboard/help/page.tsx")
const primitives = read("components/dashboard/DashboardPrimitives.tsx")

/* ── 1. Admin: internal operator tools ─────────────────────────────────────── */

describe("Admin internal operator tools", () => {
  it("is still mounted from Admin exactly as before", () => {
    // The authorization wiring is unchanged; only the presentation moved.
    expect(admin).toContain("Shift4SandboxOperationsSection")
    expect(admin).toMatch(/<Shift4SandboxOperationsSection authorized=\{shift4Operator\} \/>/)
  })

  it("renders a compact summary card rather than the expanded tools", () => {
    expect(operatorCode).toContain("Internal operator tools")
    expect(operatorCode).toContain(
      "Shift4 sandbox, certification, readiness, and terminal operations."
    )
    expect(operatorCode).toContain("Open Operator Tools")
  })

  it("summarizes retail connection, readiness, and certification", () => {
    expect(operatorCode).toContain('label: "Retail connection"')
    expect(operatorCode).toContain('label: "Readiness"')
    expect(operatorCode).toContain('label: "Certification"')
  })

  it("reports an unavailable snapshot instead of guessing a status", () => {
    // No session, a failed read, or the REST gate being off must not render as
    // a real "Not connected" answer.
    expect(operatorCode).toMatch(/if \(!readiness\)/)
    expect(operatorCode).toContain('"Unavailable"')
  })

  it("reads the summary through the existing readiness client only", () => {
    expect(operatorCode).toContain("fetchShift4Readiness")
    expect(operatorCode).toContain('from "@/lib/shift4/readinessClient"')
    // No second endpoint, and no polling.
    expect(operatorCode).not.toMatch(/setInterval/)
    expect(operatorCode).not.toMatch(/fetch\(\s*["'`]/)
  })

  it("keeps the tools behind a dialog that can be closed", () => {
    expect(operatorCode).toContain('role="dialog"')
    expect(operatorCode).toContain('aria-modal="true"')
    expect(operatorCode).toContain('data-pinetree-overlay="true"')
    expect(operatorCode).toContain("modalCloseButtonClass")
    expect(operatorCode).toContain('aria-label="Close operator tools"')
    // Opening and closing are pure local state — closing returns Admin to the
    // compact card and performs no provider action.
    expect(operatorCode).toMatch(/const \[toolsOpen, setToolsOpen\] = useState\(false\)/)
    expect(operatorCode).toContain("setToolsOpen(true)")
    expect(operatorCode).toContain("setToolsOpen(false)")
  })

  it("scrolls the tools inside the dialog so Admin itself stays compact", () => {
    expect(operatorCode).toContain("overflow-y-auto")
    expect(operatorCode).toContain("max-h-[92vh]")
  })

  it("does not require horizontal scrolling at laptop widths", () => {
    // The dialog is wide enough for the cards' own multi-column grids...
    expect(operatorCode).toContain("max-w-5xl")
    expect(operatorCode).not.toContain("max-w-[880px]")
    // ...and min-w-0 runs the whole chain, so a long fingerprint or correlation
    // id wraps instead of widening the dialog. A grid/flex child defaults to
    // min-width:auto, which is what produced the sideways scrollbar.
    expect(operatorCode).toMatch(/className="min-h-0 min-w-0 flex-1[^"]*overflow-y-auto/)
    expect(operatorCode).toContain("max-w-5xl min-w-0")
    for (const card of [
      "components/dashboard/Shift4RetailConnectCard.tsx",
      "components/dashboard/Shift4RetailVerificationCard.tsx",
      "components/dashboard/Shift4RetailTerminalCard.tsx",
      "components/dashboard/Shift4RestReadinessCard.tsx",
      "components/dashboard/Shift4RetailDevelopmentReadinessCard.tsx",
    ]) {
      expect(read(card), card).toContain("min-w-0 rounded-xl border border-gray-200 bg-white p-4")
    }
    // Nothing is hidden to achieve it.
    expect(operatorCode).not.toContain("overflow-x-hidden")
  })

  it("groups the tools under PineTree blue section labels", () => {
    expect(operatorCode).toContain("function OperatorToolGroup")
    for (const group of [
      "Retail connection",
      "Terminal setup",
      "REST readiness",
      "Development readiness",
    ]) {
      expect(operatorCode, group).toContain(`<OperatorToolGroup title="${group}">`)
    }
    expect(operatorCode).toContain('tracking-[0.16em] text-[#0052FF]')
  })

  it("gives every card the same padding, border, and radius", () => {
    // The mixed blue-tinted / white-with-shadow shells are gone, which is what
    // made the dialog read as separate old cards dropped into a window.
    for (const card of [
      "components/dashboard/Shift4RetailConnectCard.tsx",
      "components/dashboard/Shift4RestReadinessCard.tsx",
    ]) {
      expect(read(card), card).not.toContain("rounded-2xl border border-blue-100 bg-blue-50/40")
    }
    for (const card of [
      "components/dashboard/Shift4RetailVerificationCard.tsx",
      "components/dashboard/Shift4RetailTerminalCard.tsx",
      "components/dashboard/Shift4RetailDevelopmentReadinessCard.tsx",
    ]) {
      expect(read(card), card).not.toContain("bg-white p-4 shadow-sm")
    }
  })

  it("preserves every existing operator card and its wiring", () => {
    for (const card of [
      "<Shift4RetailConnectCard onConnectionChanged={handleConnectionChanged} />",
      "<Shift4RetailVerificationCard />",
      "<Shift4RetailTerminalCard />",
      "<Shift4RestReadinessCard refreshVersion={readinessVersion} />",
      "<Shift4RetailDevelopmentReadinessCard />",
    ]) {
      expect(operatorSection, card).toContain(card)
    }
    // The exchange -> readiness refresh signal is untouched.
    expect(operatorCode).toMatch(/setReadinessVersion\(\(version\) => version \+ 1\)/)
  })

  it("still renders nothing at all for an unauthorized admin", () => {
    expect(operatorCode).toMatch(/if \(authorized !== true\) return null/)
    // Hooks stay above the gate so they run unconditionally.
    expect(operatorCode.indexOf("const handleConnectionChanged")).toBeLessThan(
      operatorCode.indexOf("if (authorized !== true) return null")
    )
    // And the summary read never fires before the server has authorized.
    expect(operatorCode).toMatch(/if \(authorized !== true\) return\b[\s\S]{0,200}fetchShift4Readiness/)
  })

  it("leaves the operator tools expanded nowhere on the Admin page", () => {
    // Admin must not mount the individual cards itself.
    for (const card of [
      "Shift4RetailConnectCard",
      "Shift4RetailVerificationCard",
      "Shift4RetailTerminalCard",
      "Shift4RestReadinessCard",
      "Shift4RetailDevelopmentReadinessCard",
    ]) {
      expect(stripComments(admin), card).not.toContain(card)
    }
  })
})

/* ── 2. Transactions: Channel Mix ──────────────────────────────────────────── */

describe("Transactions Channel Mix card", () => {
  it("no longer reserves dead vertical space under each row", () => {
    const card = transactions.slice(
      transactions.indexOf('title="Channel Mix"'),
      transactions.indexOf("<PineTreeInsightsCard")
    )
    // `pb-9` existed only to clear the bottom-anchored expand button.
    expect(card).not.toContain("pb-9")
    expect(card).not.toContain("bottom-2")
    // The expand control now sits beside the metric instead.
    expect(card).toContain("top-1/2 -translate-y-1/2")
  })

  it("uses the dense surface and compact metric scale", () => {
    const card = transactions.slice(
      transactions.indexOf('title="Channel Mix"'),
      transactions.indexOf("<PineTreeInsightsCard")
    )
    expect(transactions).toContain('<GroupedMetricSurface dense title="Channel Mix"')
    expect(card.match(/size="compact"/g)).toHaveLength(2)
  })

  it("keeps both channels and both expand controls", () => {
    const card = transactions.slice(
      transactions.indexOf('title="Channel Mix"'),
      transactions.indexOf("<PineTreeInsightsCard")
    )
    expect(card).toContain('label="POS Transactions"')
    expect(card).toContain('label="Online Payments"')
    expect(card).toContain('ariaLabel="Expand POS transactions chart"')
    expect(card).toContain('ariaLabel="Expand online payments chart"')
    expect(card.match(/showChannelTransactions\("pos"\)/g)).toHaveLength(2)
    expect(card.match(/showChannelTransactions\("online"\)/g)).toHaveLength(2)
  })
})

/* ── 3-5. Reports ──────────────────────────────────────────────────────────── */

describe("Reports summary card", () => {
  it("no longer renders Platform Fees in the hero", () => {
    const hero = reports.slice(
      reports.indexOf("<DashboardHeroCard"),
      reports.indexOf('<div className="space-y-3">')
    )
    expect(hero).not.toContain("Platform Fees")
    expect(hero).not.toContain("pineTreeFees")
  })

  it("keeps Merchant net and confirmed gross sales", () => {
    const hero = reports.slice(
      reports.indexOf("<DashboardHeroCard"),
      reports.indexOf('<div className="space-y-3">')
    )
    expect(hero).toContain('title="Confirmed gross sales"')
    expect(hero).toContain('label="Merchant net"')
    expect(hero).toContain("currency(summary.netSettlements)")
    expect(hero).toContain("currency(summary.grossVolume)")
  })

  it("leaves the platform-fee figure calculated and reported elsewhere", () => {
    // Presentation only: the field is still on the summary type, still returned
    // by the Engine, and still exported.
    expect(reports).toContain("pineTreeFees: number")
    expect(read("engine/reports.ts")).toContain("pineTreeFees")
  })
})

describe("Reports volume summary and payment activity", () => {
  it("does not truncate the compound status label", () => {
    expect(reports).toContain('label="Failed / incomplete"')
    const surfaces = reports.slice(
      reports.indexOf('title="Volume Summary"'),
      reports.indexOf('title="Breakdowns"')
    )
    // Every metric in these two surfaces opts out of the truncating label.
    expect(surfaces.match(/labelWrap/g)).toHaveLength(8)
  })

  it("gives each column room before packing four across", () => {
    const surfaces = reports.slice(
      reports.indexOf('title="Volume Summary"'),
      reports.indexOf('title="Breakdowns"')
    )
    // These surfaces already sit two to a row at lg, so four inner columns only
    // start at xl.
    expect(surfaces).not.toContain("lg:grid-cols-4")
    expect(surfaces.match(/xl:grid-cols-4/g)).toHaveLength(2)
  })

  it("offers the wrapping label as an explicit opt-in on the shared metric", () => {
    expect(primitives).toContain("labelWrap = false")
    expect(primitives).toContain('labelWrap ? "break-words" : "truncate"')
  })

  it("preserves the underlying counts", () => {
    expect(reports).toContain("`${summary.failedCount} / ${summary.incompleteCount}`")
    expect(reports).toContain("`${summary.waitingCount} / ${summary.processingCount}`")
  })
})

describe("Reports status breakdown", () => {
  it("is one card rather than one card per status", () => {
    const section = reportsCode.slice(
      reportsCode.indexOf('title="Status Breakdown"'),
      reportsCode.indexOf("<PineTreeInsightsCard")
    )
    expect(reportsCode).toContain('<GroupedMetricSurface title="Status Breakdown"')
    // The per-status bordered box is gone.
    expect(section).not.toContain('className="rounded-xl border border-gray-200 bg-white')
    expect(section).not.toContain("<DashboardSection")
  })

  it("still represents every status the Engine reported", () => {
    const section = reportsCode.slice(
      reportsCode.indexOf('title="Status Breakdown"'),
      reportsCode.indexOf("<PineTreeInsightsCard")
    )
    // Renders the whole map — no slice, no filter, no fixed status list.
    expect(section).toContain("orderStatusCounts(summary.statusCounts).map")
    expect(section).not.toMatch(/\.slice\(|\.filter\(/)
    expect(reports).toContain("function orderStatusCounts")
    // Unknown labels sort last instead of being dropped.
    expect(reports).toContain("index === -1 ? STATUS_DISPLAY_ORDER.length : index")
  })

  it("takes its colors from the shared status contract, not a local palette", () => {
    expect(reports).toContain('from "@/lib/utils/paymentStatus"')
    expect(reports).toContain("getPaymentDisplayStatus(statusLabel).tone")
    // The canonical projection: Confirmed green, Failed red, Incomplete amber,
    // Expired muted red, Canceled gray, Waiting blue.
    expect(reports).toContain('confirmed: "bg-emerald-500"')
    expect(reports).toContain('failed: "bg-red-500"')
    expect(reports).toContain('incomplete: "bg-amber-500"')
    expect(reports).toContain('expired: "bg-rose-400"')
    expect(reports).toContain('canceled: "bg-gray-400"')
    expect(reports).toContain('waiting: "bg-blue-500"')
  })

  it("cannot be taken down by a status label the contract does not map", () => {
    // displayToneForStatus throws on an unmapped value (divergence D-2).
    expect(reports).toMatch(/try \{[\s\S]{0,160}catch \{[\s\S]{0,80}bg-gray-300/)
  })

  it("reads as a single horizontal row on desktop and wraps below it", () => {
    const section = reports.slice(
      reports.indexOf('title="Status Breakdown"'),
      reports.indexOf("<PineTreeInsightsCard")
    )
    expect(section).toContain('<MetricGrid columns="five">')
    expect(primitives).toContain('five: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5"')
  })
})

/* ── 6-7. Wallet ───────────────────────────────────────────────────────────── */

describe("Business Profile warning", () => {
  it("is a compact full-width red banner, not a floating card", () => {
    expect(profileWarning).toContain("mb-4 w-full")
    expect(requirementBanner).toContain("border-red-200")
    expect(requirementBanner).toContain("bg-red-50/70")
    // No card treatment and no hard max-width: it spans the content column.
    expect(profileWarning).not.toContain("rounded-2xl border border-gray-200 bg-white p-4")
    expect(profileWarning).not.toContain("shadow-[0_10px_30px_rgba(15,23,42,0.05)]")
    expect(profileWarning).not.toContain("max-w-2xl")
  })

  it("renders no status pill of any kind", () => {
    const markup = stripComments(profileWarning)
    expect(markup).not.toContain("ProviderStatusPill")
    expect(markup).not.toMatch(/["']Not started["']/)
    expect(markup).not.toContain("statusLabel")
  })

  it("is driven by canonical Business Profile completeness only", () => {
    // The canonical source is engine/businessProfile.ts via its own route.
    expect(profileWarning).toContain("/api/merchant/business-profile")
    // Never the verification projection, and never provider/KYB state.
    expect(profileWarning).not.toContain("/api/onboarding/business-verification")
    expect(profileWarning).not.toContain("primaryAction")
    expect(profileWarning).not.toContain("not_started")
    expect(profileWarning).not.toContain("under_review")
  })

  it("hides for a complete profile and shows for the two incomplete states", () => {
    expect(profileWarning).toContain('profileStatus === "complete"')
    expect(profileWarning).toContain('"incomplete" | "complete" | "needs_attention"')
  })

  it("treats an unknown or failed read as not-an-alert", () => {
    // A transient failure must never turn a completed profile back into an
    // incomplete merchant state.
    expect(profileWarning).toContain("profileStatus === null")
    expect(profileWarning).not.toContain('?? "not_started"')
    expect(profileWarning).not.toContain('?? "incomplete"')
  })

  it("links to the existing Business Profile destination", () => {
    expect(requirementBanner).toContain(
      "/dashboard/settings?section=business-profile&return=${returnDestination}"
    )
    expect(profileWarning).toContain("BusinessProfileRequirementBanner")
  })

  it("is mounted once in the shared dashboard shell, never per page", () => {
    expect(dashboardLayout).toContain("<BusinessProfileWarning />")
    for (const page of [
      "app/dashboard/page.tsx",
      "app/dashboard/pos/page.tsx",
      "app/dashboard/providers/page.tsx",
      "app/dashboard/wallet-setup/page.tsx",
      "app/dashboard/reports/page.tsx",
      "app/dashboard/settings/page.tsx",
    ]) {
      const source = stripComments(read(page))
      expect(source, page).not.toContain("BusinessProfileWarning")
      expect(source, page).not.toContain("BusinessProfileRequirementBanner")
    }
  })

  it("is excluded from the Admin area", () => {
    expect(dashboardLayout).toContain('pathname.startsWith("/dashboard/admin")')
    expect(dashboardLayout).toContain("<BusinessProfileWarning />")
  })
})

describe("Exactly one merchant-facing business identity surface", () => {
  it("keeps Business Profile as the only Settings identity card", () => {
    expect(settings).toContain('<DashboardSection title="Business Profile"')
    expect(settings).toContain("profileActionLabel(profileStatus)")
    // A complete profile reads Complete through the existing canonical mapping.
    expect(settings).toContain('if (status === "complete") return "Complete"')
    expect(settings).toContain('if (status === "complete") return "Edit Profile"')
  })

  it("renders no second verification card in Settings", () => {
    expect(settings).not.toContain("BusinessVerificationPanel")
    expect(settings).not.toMatch(/PineTree business verification/i)
    expect(settings).not.toMatch(/Business verification/i)
  })

  it("deletes the duplicate merchant-facing verification components", () => {
    for (const removed of [
      "components/dashboard/BusinessVerificationPanel.tsx",
      "components/dashboard/BusinessVerificationWarning.tsx",
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), removed)), removed).toBe(false)
    }
  })

  it("leaves no merchant-facing verification vocabulary anywhere in the dashboard", () => {
    for (const page of [
      "app/dashboard/layout.tsx",
      "app/dashboard/page.tsx",
      "app/dashboard/settings/page.tsx",
      "app/dashboard/wallet-setup/page.tsx",
      "app/dashboard/providers/page.tsx",
    ]) {
      const source = stripComments(read(page))
      expect(source, page).not.toContain("BusinessVerificationPanel")
      expect(source, page).not.toContain("BusinessVerificationWarning")
    }
  })

  it("names no infrastructure provider to the merchant", () => {
    expect(profileWarning.toLowerCase()).not.toContain("bridge")
    expect(requirementBanner.toLowerCase()).not.toContain("bridge")
    expect(settings.toLowerCase()).not.toContain("bridge")
  })
})

describe("Wallet total balance card", () => {
  it("does not render the connected-network count", () => {
    const hero = wallet.slice(
      wallet.indexOf("TOTAL BALANCE"),
      wallet.indexOf('ariaLabel="Wallet workflows"')
    )
    expect(hero).not.toContain("Connected Networks")
    expect(hero).not.toMatch(/\{rows\.length\}/)
    expect(wallet).not.toContain("const connectedRailCount")
  })

  it("keeps the per-network rows further down the page", () => {
    expect(wallet).toContain("WALLET SUMMARY")
    expect(wallet).toContain("visibleRows.map")
    const chips = wallet.slice(wallet.indexOf("function EnabledRailChips("))
    expect(chips).toContain("Connected Networks")
  })
})

/* ── 8-9. Providers and Help Center heroes ─────────────────────────────────── */

describe("Providers hero card", () => {
  it("renders no connected-provider count", () => {
    expect(providers).not.toContain('label: "Connected Providers"')
    expect(providers).not.toContain("connectedAndEnabledProvidersCount")
  })

  it("keeps the provider cards themselves", () => {
    expect(providers).toContain("ProviderCard")
    for (const provider of ["Stripe", "Fluid Pay"]) {
      expect(providers).toContain(provider)
    }
  })
})

describe("Help Center hero card", () => {
  it("keeps its controls and its ticket metric", () => {
    expect(help).toContain('eyebrow="HELP CENTER"')
    expect(help).toContain('label: "Open Tickets"')
    expect(help).toContain('ticketsLoading || ticketError ? "—" : openTicketCount')
    expect(help).toContain("HELP_NAV_ITEMS")
  })

  it("no longer centers its content in an oversized card", () => {
    // The hero carries a metric but no inline value, so the shared card
    // top-aligns the two columns instead of bottom-aligning them.
    const hero = help.slice(help.indexOf("<DashboardHeroCard"), help.indexOf("HELP_NAV_ITEMS.map"))
    expect(hero).not.toContain("value={")
    expect(primitives).toContain(': "flex-col sm:flex-row sm:items-start sm:justify-between"')
  })
})

/* ── 10. Consistency ───────────────────────────────────────────────────────── */

describe("shared card system is preserved", () => {
  it("keeps one card surface definition, radius, and shadow", () => {
    // Matched with \s+ so the assertion does not depend on the working copy's
    // line endings.
    expect(primitives).toMatch(
      /const surfaceClass =\s+"border border-gray-200\/80 bg-white shadow-\[0_10px_30px_rgba\(15,23,42,0\.05\)\]"/
    )
    expect(primitives).toContain("rounded-2xl")
    expect(primitives).toContain("rounded-[1.35rem]")
  })

  it("introduces no fixed or minimum heights on the cards this pass touched", () => {
    const channelMix = transactions.slice(
      transactions.indexOf('title="Channel Mix"'),
      transactions.indexOf("<PineTreeInsightsCard")
    )
    const statusBreakdown = reports.slice(
      reports.indexOf('title="Status Breakdown"'),
      reports.indexOf("<PineTreeInsightsCard")
    )
    for (const [name, markup] of [
      ["channel mix", channelMix],
      ["status breakdown", statusBreakdown],
      ["business profile warning", profileWarning],
    ] as const) {
      expect(markup, name).not.toMatch(/\bmin-h-\[|\bh-\[\d/)
    }
  })

  it("keeps the PineTree blue accent on section labels", () => {
    expect(primitives).toContain("text-[#0052FF]")
    expect(operatorCode).toContain("text-[#0052FF]")
  })
})
