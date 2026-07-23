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
      page.indexOf("activeView === null")
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
  function overviewRecentWithdrawalsSrc() {
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

  it("Overview's Recent Withdrawals shows a loading state before the first sync, ahead of the empty-state text", () => {
    const src = overviewRecentWithdrawalsSrc()
    expect(src).toContain("const hasSyncedOnce = Boolean(sync?.lastSyncedAt)")
    const loadingIndex = src.indexOf("!hasSyncedOnce && syncing")
    const emptyIndex = src.indexOf("No recent withdrawals yet.")
    expect(loadingIndex).toBeGreaterThan(-1)
    expect(emptyIndex).toBeGreaterThan(-1)
    expect(loadingIndex).toBeLessThan(emptyIndex)
  })

  it("the Activity tab shows a loading state before the first sync, ahead of the empty-state text", () => {
    const src = activityTabSrc()
    expect(src).toContain("const hasSyncedOnce = Boolean(sync?.lastSyncedAt)")
    const loadingIndex = src.indexOf("!hasSyncedOnce && syncing")
    const emptyIndex = src.indexOf("No withdrawals yet.")
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

describe("Mobile wallet workflow navigation stays contained", () => {
  it("workflow navigation reuses the shared segmented button component", () => {
    const navBlock = page.slice(
      page.indexOf('ariaLabel="Wallet workflows"') - 400,
      page.indexOf('ariaLabel="Wallet workflows"') + 500
    )
    expect(navBlock).toContain("<SegmentedButtons")
    expect(navBlock).toContain("walletWorkflowOptions")
    expect(page).toContain('className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"')
    expect(page).toContain('rounded-2xl border border-gray-200/80 bg-white p-3 shadow-sm')
  })

  it("overview and address-book are not permanent navigation buttons", () => {
    expect(page).not.toContain('{ id: "overview", label: "Overview" }')
    expect(page).not.toContain('{ id: "balances", label: "Balances" }')
    expect(page).not.toContain('{ id: "address-book", label: "Address Book" }')
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

  function overviewSrc() {
    return page.slice(
      page.indexOf("function WalletOverviewSummary("),
      page.indexOf("function AssetSelectDropdown(")
    )
  }

  it("does not wrap the ready wallet route in a giant workspace card", () => {
    const workspaceOpen = page.slice(
      page.indexOf('aria-label="PineTree Wallet workspace"'),
      page.indexOf("activeView === null")
    )
    expect(workspaceOpen).toContain('className="space-y-5"')
    expect(workspaceOpen).not.toContain("max-w-[42rem]")
    expect(workspaceOpen).not.toContain("overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95")
    expect(workspaceOpen).not.toContain("shadow-[0_32px_100px")
  })

  it("renders the overview directly with Total Balance as the first card", () => {
    const src = workspaceSrc()
    const overview = overviewSrc()
    expect(src).toContain("activeView === null")
    expect(src).toContain("<WalletOverviewSummary")
    expect(src).not.toContain('className="flex flex-wrap gap-1.5 pt-1"')
    expect(overview.indexOf("TOTAL BALANCE")).toBeLessThan(overview.indexOf("<SegmentedButtons"))
    expect(overview.indexOf("<SegmentedButtons")).toBeLessThan(overview.indexOf("WALLET SUMMARY"))
    expect(overview.indexOf("WALLET SUMMARY")).toBeLessThan(overview.indexOf("RECENT WITHDRAWALS"))
    expect(overview.indexOf("RECENT WITHDRAWALS")).toBeLessThan(overview.indexOf("AddressBookPreviewCard"))
    expect(src).not.toContain('aria-label="PineTree Wallet sections"')
    expect(src).not.toContain('activeTab === "overview"')
    expect(src).not.toContain('activeTab === "balances"')
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

  it("secondary wallet views render as floating workspaces with the standard outlined X", () => {
    const src = workspaceSrc()
    expect(page).toContain("function WalletFloatingWorkspace")
    expect(page).toContain("className={modalCloseButtonClass}")
    expect(page).toContain('aria-label="Return to Wallet Overview"')
    expect(src).toContain('activeView === "withdraw"')
    expect(src).toContain('activeView === "activity"')
    expect(src).toContain('activeView === "base-details"')
    expect(src).toContain('activeView === "solana-details"')
    expect(src).toContain('activeView === "bitcoin-details"')
    expect(src).toContain('activeView === "address-book"')
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
