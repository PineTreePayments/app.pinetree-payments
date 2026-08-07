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
const verificationWarning = read("components/dashboard/BusinessVerificationWarning.tsx")
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

describe("Wallet business verification notice", () => {
  it("is a compact horizontal warning, not a floating feature card", () => {
    expect(verificationWarning).toContain('className="mb-4 flex w-full flex-wrap items-center')
    expect(verificationWarning).toContain("border-red-200 bg-red-50/70")
    // The card treatment it replaced is gone.
    expect(verificationWarning).not.toContain("rounded-2xl border border-gray-200 bg-white p-4")
    expect(verificationWarning).not.toContain("shadow-[0_10px_30px_rgba(15,23,42,0.05)]")
    // No hard max-width constraint: it spans the full dashboard content column.
    expect(verificationWarning).not.toContain("max-w-2xl")
  })

  it("renders on one line when there is room and wraps when there is not", () => {
    expect(verificationWarning).toContain("flex-wrap")
    expect(verificationWarning).toContain("items-center")
    // The message takes the remaining width, so the action stays on the same
    // line until there is genuinely no room for it.
    expect(verificationWarning).toContain("flex-1")
  })

  it("uses a red-tinted treatment only where the merchant must act", () => {
    expect(verificationWarning).toContain("border-red-200 bg-red-50/70")
    // The Engine's `primaryAction` is documented as the single next action a
    // merchant can take, so `none` is the complete, canonical test for "nothing
    // is owed" — submitted, processing, under review, verified, and
    // temporarily unavailable all project to it.
    expect(verificationWarning).toContain('verification.primaryAction.kind !== "none"')
    // Work already underway is not an alert, and the warning never restates
    // the status vocabulary it would then have to keep in sync.
    expect(verificationWarning).not.toContain("border-amber-200 bg-amber-50")
    expect(verificationWarning).not.toContain("under_review")
    expect(verificationWarning).not.toContain("in_progress")
  })

  it("shows for every action the merchant owes, including consent", () => {
    for (const kind of ["complete_profile", "review_and_consent", "continue_verification"]) {
      expect(verificationWarning, kind).toContain(kind)
    }
  })

  it("contains no status pill and no Not-started pill", () => {
    // Asserted against the code, not the docstring: the comment explaining the
    // old "Not started" defect must not itself fail the test.
    const markup = stripComments(verificationWarning)
    expect(markup).not.toContain("ProviderStatusPill")
    expect(markup).not.toMatch(/["']Not started["']/)
    expect(markup).not.toContain("statusLabel")
  })

  it("changes no verification logic or status detection", () => {
    // Same Engine endpoint, read-only.
    expect(verificationWarning).toContain("/api/onboarding/business-verification")
    // No provider calls, no refresh, no continue from this operational surface.
    expect(verificationWarning).not.toContain("/refresh")
    expect(verificationWarning).not.toContain("/continue")
  })

  it("is mounted once in the shared dashboard shell across normal pages", () => {
    // The shared merchant dashboard layout owns the warning, not individual pages.
    expect(dashboardLayout).toContain("<BusinessVerificationWarning />")
    expect(dashboardLayout).toContain("BusinessVerificationWarning")
    for (const page of [
      "app/dashboard/page.tsx",
      "app/dashboard/pos/page.tsx",
      "app/dashboard/providers/page.tsx",
      "app/dashboard/wallet-setup/page.tsx",
      "app/dashboard/reports/page.tsx",
    ]) {
      expect(stripComments(read(page)), page).not.toContain("BusinessVerificationWarning")
    }
  })

  it("is excluded from the Admin area", () => {
    expect(dashboardLayout).toContain('pathname.startsWith("/dashboard/admin")')
    expect(dashboardLayout).toContain("<BusinessVerificationWarning />")
  })

  it("never fabricates a status when the read fails", () => {
    // The original defect: the panel fell back to `status ?? "not_started"`, so
    // a failed fetch rendered a red "complete your business profile" alert to a
    // merchant whose profile was already complete.
    expect(verificationWarning).not.toContain('?? "not_started"')
    expect(verificationWarning).toContain("requiresMerchantAction(verification)")
    const panel = read("components/dashboard/BusinessVerificationPanel.tsx")
    expect(panel).not.toContain('?? "not_started"')
    expect(panel).toContain('"Unavailable"')
  })
})

describe("Settings is the verification status home", () => {
  const settings = read("app/dashboard/settings/page.tsx")
  const panel = read("components/dashboard/BusinessVerificationPanel.tsx")

  it("mounts the detailed panel in Settings", () => {
    expect(settings).toContain("<BusinessVerificationPanel />")
    expect(settings).toContain(
      'import BusinessVerificationPanel from "@/components/dashboard/BusinessVerificationPanel"'
    )
  })

  it("keeps the states the operational warning deliberately hides", () => {
    // Settings must still show progress the merchant cannot act on.
    for (const state of ["under_review", "in_progress", "verified"]) {
      expect(panel, state).toContain(state)
    }
    expect(panel).toContain("verification.statusLabel")
    expect(panel).toContain("ProviderStatusPill")
  })

  it("keeps the merchant action and the status check", () => {
    expect(panel).toContain("handlePrimaryAction()")
    expect(panel).toContain("handleCheckStatus()")
    expect(panel).toContain('callApi("/refresh", "POST")')
    expect(panel).toContain('callApi("/continue", "POST")')
  })

  it("names no infrastructure provider to the merchant", () => {
    expect(panel.toLowerCase()).not.toContain("bridge")
    expect(verificationWarning.toLowerCase()).not.toContain("bridge")
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
      ["verification warning", verificationWarning],
    ] as const) {
      expect(markup, name).not.toMatch(/\bmin-h-\[|\bh-\[\d/)
    }
  })

  it("keeps the PineTree blue accent on section labels", () => {
    expect(primitives).toContain("text-[#0052FF]")
    expect(operatorCode).toContain("text-[#0052FF]")
  })
})
