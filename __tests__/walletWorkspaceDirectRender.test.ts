import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const page = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/wallet-setup/page.tsx"),
  "utf8"
)
const layout = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/layout.tsx"),
  "utf8"
)

// Regression coverage for the "Wallet route only renders after a hard refresh"
// bug: the workspace used to be gated behind `walletOpen`, a flag that only
// flipped true after an async Dynamic-signer hydration chain (handleOpenWallet)
// completed. On a fresh navigation that hydration could silently fail to ever
// resolve (see directWalletOpenAttemptedRef races), leaving the page blank
// under the wallet heading until a hard refresh reset the ref.
describe("PineTree Wallet workspace renders directly on the route, not behind a modal gate", () => {
  it("the workspace section is gated on showWalletWorkspace, never on walletOpen", () => {
    expect(page).toContain("{showWalletWorkspace ? (")
    expect(page).not.toContain("{walletOpen ? (")
  })

  it("showWalletWorkspace depends only on wallet/profile readiness - not on walletOpen or the hydration ref", () => {
    expect(page).toContain('const showWalletSetupCard = walletSetupPrimaryState !== "ready" || !hasWallet')
    expect(page).toContain("const showWalletWorkspace = !showWalletSetupCard")
  })

  it("the workspace section is no longer a fixed-position overlay requiring a launcher click", () => {
    const workspaceBlock = page.slice(
      page.indexOf("{showWalletWorkspace ? ("),
      page.indexOf("{showWalletWorkspace ? (") + 400
    )
    expect(workspaceBlock).not.toContain("fixed inset-0")
    expect(workspaceBlock).not.toContain('role="presentation"')
    expect(workspaceBlock).not.toContain('role="dialog"')
    expect(workspaceBlock).not.toContain('aria-modal="true"')
  })

  it("page mode has no duplicate workspace header inside the wallet content", () => {
    const workspaceBlock = page.slice(
      page.indexOf('aria-label="PineTree Wallet workspace"'),
      page.indexOf('aria-label="PineTree Wallet sections"')
    )
    const pageComponent = page.slice(page.indexOf("export default function PineTreeWalletPage()"))
    expect(pageComponent).toContain('<h1 className={dashboardPageTitleClass}>PineTree Wallet</h1>')
    expect(workspaceBlock).not.toContain("<header")
    expect(workspaceBlock).not.toContain("<h2")
    expect(workspaceBlock).not.toContain('aria-label="Close PineTree Wallet"')
    expect(workspaceBlock).not.toContain("onClick={handleRequestCloseWallet}")
  })

  it("there is no dead close-confirmation machinery left over from modal mode", () => {
    expect(page).not.toContain("function handleRequestCloseWallet")
    expect(page).not.toContain("withdrawalDiscardConfirmOpen")
    expect(page).not.toContain("function handleConfirmDiscardWithdrawal")
    expect(page).not.toContain("Escape key closes modal")
  })

  it("the sidebar's single Wallet entry points straight at the route with no query-param gate", () => {
    expect(layout).toContain('{ name: "Wallet", href: "/dashboard/wallet-setup" }')
  })

  it("the wallet page mounts the runtime unconditionally - no open prop, no searchParams gate", () => {
    const pageComponent = page.slice(
      page.indexOf("export default function PineTreeWalletPage()"),
      page.length
    )
    expect(pageComponent).toContain("<PineTreeWalletRuntime />")
    expect(pageComponent).not.toContain("searchParams")
    expect(pageComponent).not.toContain("useSearchParams")
  })
})

describe("Wallet workspace loading state is distinct from empty state", () => {
  function overviewRecentActivitySrc() {
    return page.slice(
      page.indexOf("function WalletOverviewSummary("),
      page.indexOf("function AssetSelectDropdown(")
    )
  }

  function activityTabSrc() {
    return page.slice(
      page.indexOf("function ActivityTab("),
      page.indexOf("function mapActivityDetailStatus(")
    )
  }

  function balanceRowsSrc() {
    return page.slice(
      page.indexOf("function BalanceRows("),
      page.indexOf("function EnabledRailChips(")
    )
  }

  it("Overview's Recent Activity shows a loading state before the first sync, ahead of the empty-state text", () => {
    const src = overviewRecentActivitySrc()
    expect(src).toContain("const hasSyncedOnce = Boolean(sync?.lastSyncedAt)")
    const loadingIndex = src.indexOf("!hasSyncedOnce && syncing")
    const emptyIndex = src.indexOf("No wallet activity yet.")
    expect(loadingIndex).toBeGreaterThan(-1)
    expect(emptyIndex).toBeGreaterThan(-1)
    expect(loadingIndex).toBeLessThan(emptyIndex)
  })

  it("the Activity tab shows a loading state before the first sync, ahead of the empty-state text", () => {
    const src = activityTabSrc()
    expect(src).toContain("const hasSyncedOnce = Boolean(sync?.lastSyncedAt)")
    const loadingIndex = src.indexOf("!hasSyncedOnce && syncing")
    const emptyIndex = src.indexOf("No wallet activity yet.")
    expect(loadingIndex).toBeGreaterThan(-1)
    expect(emptyIndex).toBeGreaterThan(-1)
    expect(loadingIndex).toBeLessThan(emptyIndex)
  })

  it("Balances shows a loading state before the first sync, ahead of the 'No balances yet' text", () => {
    const src = balanceRowsSrc()
    const loadingIndex = src.indexOf("!hasSyncedOnce && syncing")
    const emptyIndex = src.indexOf("No balances yet")
    expect(loadingIndex).toBeGreaterThan(-1)
    expect(emptyIndex).toBeGreaterThan(-1)
    expect(loadingIndex).toBeLessThan(emptyIndex)
  })
})

describe("Mobile wallet workspace tabs stay contained (no full-page horizontal overflow)", () => {
  it("the five-tab strip uses a wrapping responsive grid, not an unconstrained flex row", () => {
    const navBlock = page.slice(
      page.indexOf('aria-label="PineTree Wallet sections"') - 200,
      page.indexOf('aria-label="PineTree Wallet sections"') + 200
    )
    expect(navBlock).toContain("grid-cols-2")
    expect(navBlock).toContain("min-[420px]:grid-cols-3")
    expect(navBlock).toContain("sm:grid-cols-5")
  })

  it("tab labels can wrap on narrow viewports instead of clipping or forcing overflow", () => {
    const buttonClassIndex = page.indexOf("min-h-10 rounded-xl px-3 py-2 text-center text-xs font-semibold leading-tight")
    expect(buttonClassIndex).toBeGreaterThan(-1)
    const buttonClass = page.slice(buttonClassIndex - 40, buttonClassIndex + 150)
    expect(buttonClass).not.toMatch(/(?<!sm:)whitespace-nowrap/)
    expect(buttonClass).toContain("sm:whitespace-nowrap")
  })
})

describe("Wallet dashboard page hierarchy matches Reports-style surfaces", () => {
  function runtimeSrc() {
    return page.slice(
      page.indexOf("function PineTreeWalletRuntime("),
      page.indexOf("function PineTreeWalletPage(")
    )
  }

  function workspaceSrc() {
    const src = runtimeSrc()
    const end = src.indexOf("// ---------------------------------------------------------------------------\n// Page")
    return src.slice(
      src.indexOf('aria-label="PineTree Wallet workspace"'),
      end > -1 ? end : src.length
    )
  }

  function balanceRowsSrc() {
    return page.slice(
      page.indexOf("function BalanceRows("),
      page.indexOf("function EnabledRailChips(")
    )
  }

  function activityTabSrc() {
    return page.slice(
      page.indexOf("function ActivityTab("),
      page.indexOf("function mapActivityDetailStatus(")
    )
  }

  it("does not wrap the ready wallet route in a giant workspace card", () => {
    const workspaceOpen = page.slice(
      page.indexOf('aria-label="PineTree Wallet workspace"'),
      page.indexOf('aria-label="PineTree Wallet sections"')
    )
    expect(workspaceOpen).toContain('className="space-y-4 md:space-y-5"')
    expect(workspaceOpen).not.toContain("max-w-[42rem]")
    expect(workspaceOpen).not.toContain("overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95")
    expect(workspaceOpen).not.toContain("shadow-[0_32px_100px")
  })

  it("renders wallet tabs before content cards, outside the tab body", () => {
    const src = workspaceSrc()
    expect(src.indexOf('aria-label="PineTree Wallet sections"')).toBeLessThan(src.indexOf('activeTab === "overview"'))
    expect(src.indexOf('aria-label="PineTree Wallet sections"')).toBeLessThan(src.indexOf('activeTab === "balances"'))
    expect(src).toContain('<div className="min-w-0">')
  })

  it("renders balances as a complete card list without selected dropdown state", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("balanceOptions.map((row)")
    expect(src).toContain("key={row.key}")
    expect(src).not.toContain("selectedKey")
    expect(src).not.toContain("onSelectKey")
    expect(src).not.toContain("dropdownOptions")
    expect(src).not.toContain("AssetSelectDropdown")
  })

  it("withdrawal details use shared overlay structure and omit merchant-facing internals", () => {
    const src = activityTabSrc()
    expect(src).toContain('data-pinetree-overlay="true"')
    expect(src).toContain("pinetree-modal-backdrop")
    expect(src).not.toContain(">Advanced<")
    expect(src).not.toContain("Provider Reference")
    expect(src).not.toContain("Raw provider status")
    expect(src).not.toContain("Settlement Reference")
  })

  it("wallet withdrawal status pills use the shared platform status component", () => {
    expect(page).toContain('import StatusBadge from "@/components/ui/StatusBadge"')
    expect(page).toContain("function ActivityStatusPill")
    expect(page).toContain("<StatusBadge status={status} />")
  })

  it("activity rows remain tappable and open details", () => {
    const src = activityTabSrc()
    expect(src).toContain("items.map((item)")
    expect(src).toContain("onClick={() => void openActivityDetail(item)}")
    expect(src).toContain('type="button"')
  })
})
