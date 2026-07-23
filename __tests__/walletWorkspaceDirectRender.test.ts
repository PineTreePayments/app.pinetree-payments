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
      page.indexOf('ariaLabel="Wallet workflows"') + 700
    )
    expect(navBlock).toContain("<SegmentedButtons")
    expect(navBlock).toContain("walletWorkflowOptions")
    expect(page).toContain('{ value: "withdraw", label: "Withdraw" }')
    expect(page).toContain('{ value: "activity", label: "Activity" }')
    expect(page).toContain('{ value: "address-book", label: "Address Book" }')
    expect(page).toContain('{ value: "settings", label: "Settings" }')
    expect(page).toContain('className="grid grid-cols-4 gap-1.5"')
  })

  it("overview and balances are not permanent navigation buttons", () => {
    expect(page).not.toContain('{ id: "overview", label: "Overview" }')
    expect(page).not.toContain('{ id: "balances", label: "Balances" }')
  })

  it("segmented controls use PineTree blue outline and pale-blue inactive fill", () => {
    const segmented = fs.readFileSync(
      path.join(process.cwd(), "components/ui/SegmentedButtons.tsx"),
      "utf8"
    )
    expect(segmented).toContain("border-blue-600 bg-blue-600 font-semibold text-white shadow-sm")
    expect(segmented).toContain("border-blue-200 bg-blue-50/70 font-medium text-blue-700")
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
    expect(page).not.toContain("function AddressBookPreviewCard")
    expect(overview).not.toContain("AddressBookPreviewCard")
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
    expect(src).toContain('activeView === "settings"')
  })

  it("address book and settings are secondary workspaces reached from workflow navigation", () => {
    const src = workspaceSrc()
    const overview = overviewSrc()
    expect(overview).toContain('if (value === "address-book") onOpenAddressBook()')
    expect(overview).toContain('if (value === "settings") onOpenSettings()')
    expect(src).toContain("<AddressBookTab accessToken={accessTokenRef.current} onWithdraw={handleWithdrawShortcut} />")
    expect(src).toContain("<WalletSettingsWorkspace />")
  })

  it("activity control and View All Withdrawals open the same Activity workspace", () => {
    const overview = overviewSrc()
    const src = workspaceSrc()
    expect(overview).toContain('if (value === "activity") onViewAllActivity?.()')
    expect(overview).toContain("onClick={onViewAllActivity}")
    expect(src).toContain('onViewAllActivity={() => setActiveView("activity")}')
    expect(src).toContain('activeView === "activity"')
    expect(src).toContain("<ActivityTab sync={walletSync} syncing={walletSyncing} accessToken={accessTokenRef.current} />")
  })

  it("asset detail workspaces use blue section headings and direct withdraw buttons", () => {
    const src = workspaceSrc()
    const rows = balanceRowsSrc()
    expect(page).toContain("function handleAssetDetailWithdraw")
    expect(page).toContain("setWithdrawalRail(rail)")
    expect(page).toContain("setWithdrawalAsset(asset)")
    expect(page).toContain('setActiveView("withdraw")')
    expect(page).toContain('pendingBalance("BASE_ETH", "base", "ETH", "base", "dynamic", 18)')
    expect(page).toContain('pendingBalance("BASE_USDC", "base", "USDC", "base", "dynamic", 6)')
    expect(page).toContain('pendingBalance("SOLANA_SOL", "solana", "SOL", "solana", "dynamic", 9)')
    expect(page).toContain('pendingBalance("SOLANA_USDC", "solana", "USDC", "solana", "dynamic", 6)')
    expect(page).toContain('pendingBalance("BTC", "bitcoin", "BTC", "bitcoin_lightning", "speed", 8)')
    expect(page).toContain('onWithdrawAsset={handleAssetDetailWithdraw}')
    expect(rows).toContain("onWithdrawAsset: (rail: WithdrawalRail, asset: WithdrawalAsset) => void")
    expect(rows).toContain("onClick={() => onWithdrawAsset(row.rail, row.asset)}")
    expect(rows).toContain("Withdraw")
    expect(page).toContain('<h2 className={`min-w-0 ${dashboardSectionLabelClass}`}>{title.toUpperCase()}</h2>')
    expect(src).toContain('title="Base Details"')
    expect(src).toContain('title="Solana Details"')
    expect(src).toContain('title="Bitcoin Details"')
  })

  it("wallet withdrawal status pills use the shared platform status component", () => {
    expect(page).toContain('import StatusBadge from "@/components/ui/StatusBadge"')
    expect(page).toContain("function ActivityStatusPill")
    expect(page).toContain("<StatusBadge status={status} />")
    const overview = overviewSrc()
    const activity = activityTabSrc()
    expect(overview).toContain("<ActivityStatusPill status={item.status} />")
    expect(activity).toContain("<ActivityStatusPill status={item.status} />")
    expect(overview).not.toContain("justify-stretch")
  })

  it("activity rows remain tappable and open details", () => {
    const src = activityTabSrc()
    expect(src).toContain("items.map((item)")
    expect(src).toContain("onClick={() => void openActivityDetail(item)}")
    expect(src).toContain('type="button"')
  })

  it("wallet settings is disabled future configuration scaffolding", () => {
    expect(page).toContain("function WalletSettingsWorkspace")
    expect(page).toContain("AUTO CONVERSION")
    expect(page).toContain("WITHDRAW TO BANK")
    expect(page).toContain("Coming soon")
    expect(page).toContain("Not yet available")
    expect(page).toContain("<fieldset disabled")
    expect(page).not.toContain("from(\"wallet_settings\")")
  })
})

describe("Providers page keeps wallet settings out of provider management", () => {
  const providers = fs.readFileSync(
    path.join(process.cwd(), "app/dashboard/providers/page.tsx"),
    "utf8"
  )

  it("removes the misplaced Engine Settings presentation from Providers", () => {
    expect(providers).not.toContain("Engine Settings")
    expect(providers).not.toContain("Smart Routing")
    expect(providers).not.toContain("Auto Convert to Fiat")
    expect(providers).not.toContain("engineSettingsPanel")
    expect(providers).not.toContain("updateSettings")
  })
})
