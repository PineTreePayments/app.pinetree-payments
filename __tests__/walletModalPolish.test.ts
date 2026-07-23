import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { formatWalletTotalBalance } from "@/lib/pinetreeWalletDisplay"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

const walletPage = read("app/dashboard/wallet-setup/page.tsx")
const providersPage = read("app/dashboard/providers/page.tsx")
const dynamicProvider = read("components/providers/PineTreeDynamicProvider.tsx")

function walletOverviewSrc() {
  return walletPage.slice(
    walletPage.indexOf("function WalletOverviewSummary("),
    walletPage.indexOf("function AssetSelectDropdown(")
  )
}

function balanceRowsSrc() {
  return walletPage.slice(
    walletPage.indexOf("function BalanceRows("),
    walletPage.indexOf("function EnabledRailChips(")
  )
}

function withdrawalFormSrc() {
  return walletPage.slice(
    walletPage.indexOf("function WithdrawalFormShell("),
    walletPage.indexOf("function formatUsd(")
  )
}

function runtimeSrc() {
  return walletPage.slice(
    walletPage.indexOf("function PineTreeWalletRuntime("),
    walletPage.indexOf("function PineTreeWalletPage(")
  )
}

describe("Wallet overview - polished PineTree summary", () => {
  it("renders total balance hero card with blue glow treatment", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("TOTAL BALANCE")
    expect(src).toContain("formatWalletTotalBalance(sync?.totalUsd, syncing)")
    expect(src).toContain("radial-gradient")
    expect(src).toContain("border-blue-")
    expect(src).toContain("shadow-[0_22px_50px")
  })

  it("formats Total Balance safely while loading or empty", () => {
    expect(formatWalletTotalBalance(null, true)).toBe("Syncing...")
    expect(formatWalletTotalBalance(null, false)).toBe("\u2014")
    expect(formatWalletTotalBalance(undefined, false)).toBe("\u2014")
    expect(formatWalletTotalBalance(0, false)).toBe("$0.00")
  })

  it("wallet setup source contains no malformed encoded balance literals", () => {
    expect(walletPage).not.toMatch(/Ã¢|aeâ|â€”|â€¦|â‰ˆ|Â/)
  })

  it("renders Wallet Summary with blue-tinted border and divider", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("WALLET SUMMARY")
    expect(src).toContain("border-blue-200")
    expect(src).toContain("border-b border-blue-")
  })

  it("Wallet Summary rows keep rail, status, and amount aligned", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("grid-cols-[minmax(0,1fr)_auto_auto_auto]")
    expect(src).toContain("sm:grid-cols-[minmax(0,1fr)_7.75rem_minmax(5.75rem,auto)_auto]")
    expect(src).toContain("className=\"flex justify-center\"")
    expect(src).toContain("ProviderStatusPill")
    expect(src).toContain("<ChevronRight")
    expect(src).toContain("text-right")
  })

  it("PineTree Wallet statuses use the shared platform status badge", () => {
    expect(walletPage).not.toContain("function WalletStatusPill")
    expect(walletPage).toContain("function ActivityStatusPill")
    expect(walletPage).toContain("<StatusBadge status={status} />")
    expect(walletPage).toContain('import StatusBadge from "@/components/ui/StatusBadge"')
    expect(walletOverviewSrc()).toContain("ActivityStatusPill")
    expect(walletOverviewSrc()).toContain("<ProviderStatusPill")
  })

  it("Overview renders Total Balance, workflow navigation, Wallet Summary, and Recent Withdrawals only", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("TOTAL BALANCE")
    expect(src).toContain('ariaLabel="Wallet workflows"')
    expect(src).toContain("WALLET SUMMARY")
    expect(src).toContain("RECENT WITHDRAWALS")
    expect(src).toContain("recentItems")
    expect(src).toContain("slice(0, 3)")
    expect(src).toContain("View All Withdrawals")
    expect(src).not.toContain("AddressBookPreviewCard")
    expect(walletPage).not.toContain("function AddressBookPreviewCard")
    expect(src).not.toContain("Bitcoin Lightning payout")
    expect(src).not.toContain("RECENT ACTIVITY")
  })

  it("shows Last synced or Pending sync copy", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("Last synced")
    expect(src).toContain("Pending sync")
  })

  it("rail summary rows use configured && enabled for Connected / Not connected", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("{row.label}")
    expect(walletPage).toContain('label: "Base" as const')
    expect(walletPage).toContain('label: "Solana" as const')
    expect(walletPage).toContain('label: "Bitcoin" as const')
    expect(src).toContain("row.configured && row.enabled")
    expect(src).toContain('"Connected" : "Not connected"')
    expect(src).not.toContain('"Disabled"')
  })
})

describe("Rail detail workspaces - complete standalone balance card list", () => {
  it("BalanceRows renders all live balance options as cards without a dropdown dependency", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("balanceOptions")
    expect(src).toContain("balanceOptions.map((row)")
    expect(src).toContain("md:grid-cols-2")
    expect(src).toContain("xl:grid-cols-3")
    expect(src).toContain("key={row.key}")
    expect(src).not.toContain("selectedKey")
    expect(src).not.toContain("onSelectKey")
    expect(src).not.toContain("dropdownOptions")
    expect(src).not.toContain("AssetSelectDropdown")
    expect(src).not.toContain('["Deposit", "Withdraw", "History"].map')
    expect(src).not.toContain("allAssets.map((row, index)")
    expect(src).not.toContain("ChevronRight")
  })

  it("each balance card shows balance, metadata, and wallet address", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("Balance")
    expect(src).toContain("formatBalance(row.balance, row.asset)")
    expect(src).toContain("Network")
    expect(src).toContain("Asset")
    expect(src).toContain("Estimated USD value")
    expect(src).toContain("Last synced")
    expect(src).toContain("Wallet address")
    expect(src).toContain('aria-label="Copy wallet address"')
  })

  it("BalanceRows shows a clean empty state when no balances are available", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("No balances yet")
    expect(src).toContain("Received funds will appear here after payments settle.")
    expect(src).toContain("if (balanceOptions.length === 0)")
  })

  it("BalanceRows selects the wallet address from the correct rail", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("profileAddresses.base[0]?.address")
    expect(src).toContain("profileAddresses.solana[0]?.address")
    expect(src).toContain("bitcoinPayoutEntries[0]?.address")
  })

  it("Base and Solana USDC remain distinct balance options", () => {
    expect(walletPage).toContain('pendingBalance("BASE_USDC", "base", "USDC", "base", "dynamic", 6)')
    expect(walletPage).toContain('pendingBalance("SOLANA_USDC", "solana", "USDC", "solana", "dynamic", 6)')
    const src = balanceRowsSrc()
    expect(src).toContain("key={row.key}")
    expect(src).toContain("{row.asset}")
    expect(src).toContain("{assetRailLabel(row.rail)}")
    expect(src).not.toContain('railLabel: "PineTree Wallet"')
  })

  it("BTC is included for a ready connected account without requiring a payout address", () => {
    const src = balanceRowsSrc()
    expect(walletPage).toContain('pendingBalance("BTC", "bitcoin", "BTC", "bitcoin_lightning", "speed", 8)')
    expect(src).toContain('if (profileAddresses.base.length > 0) rows.push(...(sync?.balances.base ?? []))')
    expect(src).toContain('if (profileAddresses.solana.length > 0) rows.push(...(sync?.balances.solana ?? []))')
    expect(src).toContain('if (bitcoinReady) rows.push(...(sync?.balances.bitcoin ?? []))')
    expect(src).toContain('if (row.rail === "bitcoin") return bitcoinReady')
  })

  it("BalanceRows detail card does not render a Status field", () => {
    const src = balanceRowsSrc()
    expect(src).not.toContain(">Status<")
    expect(src).not.toContain("selectedRailConnected")
    expect(src).not.toContain("selectedRailRow")
    expect(src).not.toContain('"Disabled"')
    expect(src).not.toContain('"Needs setup"')
    expect(src).toContain('label={row.status === "stale" ? "Stale" : "Unavailable"}')
  })

  it("BTC wallet address can exist while BTC balance indexing remains pending", () => {
    const src = balanceRowsSrc()
    expect(walletPage).toContain("railReadiness?.bitcoin_lightning.walletProvisioned ??")
    expect(walletPage).not.toContain("const bitcoinReady = bitcoinPayoutEntries.length > 0")
    expect(src).toContain("bitcoinPayoutEntries[0]?.address")
    expect(src).toContain("formatBalance(row.balance, row.asset)")
    expect(walletPage).toContain('pendingBalance("BTC", "bitcoin", "BTC", "bitcoin_lightning", "speed", 8)')
    expect(src).toContain('if (row.rail === "bitcoin") return bitcoinReady')
    expect(src).not.toContain("Speed")
  })

  it("rail detail workspaces do not render Lightning settlement UI", () => {
    const balancesSection = walletPage.slice(
      walletPage.indexOf('activeView === "bitcoin-details"'),
      walletPage.indexOf('activeView === "withdraw"')
    )
    expect(balancesSection).not.toContain("LightningSettlementPanel")
    expect(balanceRowsSrc()).not.toContain("Lightning settlement")
    expect(balanceRowsSrc()).not.toContain('asset: "LIGHTNING"')
    expect(balanceRowsSrc()).not.toContain("groups.map")
  })
})

describe("Provider-branded wallet tab removed", () => {
  it("wallet navigation keeps workflow actions and removes overview/balances tabs", () => {
    expect(walletPage).toContain(
      'type WalletSecondaryView = "withdraw" | "activity" | "address-book" | "settings" | "base-details" | "solana-details" | "bitcoin-details"'
    )
    expect(walletPage).toContain("const walletWorkflowOptions")
    expect(walletPage).toContain('{ value: "withdraw", label: "Withdraw" }')
    expect(walletPage).toContain('{ value: "activity", label: "Activity" }')
    expect(walletPage).toContain('{ value: "address-book", label: "Address Book" }')
    expect(walletPage).toContain('{ value: "settings", label: "Settings" }')
    expect(walletPage).not.toContain('{ id: "overview", label: "Overview" }')
    expect(walletPage).not.toContain('{ id: "balances", label: "Balances" }')
    expect(walletPage).not.toContain('{ id: "speed"')
    expect(walletPage).not.toContain("Speed Wallet")
    expect(walletPage).not.toContain('{ id: "automatic-settlement"')
    expect(walletPage).toContain("<SegmentedButtons")
    expect(walletPage).toContain('ariaLabel="Wallet workflows"')
    expect(walletPage).not.toContain("grid-cols-6")
    expect(walletPage).not.toContain('label: "Wallets"')
    expect(walletPage).not.toContain('activeView === "wallets"')
    expect(walletPage).not.toContain('activeView === "speed"')
    expect(walletPage).toContain('activeView === "address-book"')
  })

  it("old wallet-row and receive-row components are gone", () => {
    expect(walletPage).not.toContain("function WalletRows(")
    expect(walletPage).not.toContain("function ReceiveRow(")
    expect(walletPage).not.toContain("LightningSettlementPanel")
  })

  it("does not mount a second Bitcoin Lightning wallet panel inside Activity", () => {
    const modalSrc = runtimeSrc().slice(
      runtimeSrc().indexOf('aria-label="PineTree Wallet workspace"'),
      runtimeSrc().indexOf("// ---------------------------------------------------------------------------\n// Page")
    )
    expect(modalSrc).not.toContain("MerchantWalletManagementPanel")
    expect(modalSrc).not.toContain("Bitcoin Lightning</p>")
    expect(modalSrc).not.toContain("<BalancesCard")
    expect(modalSrc).not.toContain("<ActivityCard")
    expect(modalSrc).not.toContain("providerDisplayName")
    expect(modalSrc).not.toMatch(/\bSpeed\b/)
  })

  it("Bitcoin overview rows open rail detail workspaces without relying on a hidden selected balance", () => {
    const src = runtimeSrc()
    expect(src).toContain("handleOverviewRailSelect")
    expect(src).toContain("setActiveView(walletRailDetailView(rail))")
    expect(src).toContain("onSelectRail={handleOverviewRailSelect}")
    expect(walletOverviewSrc()).toContain("onClick={() => onSelectRail?.(row.rail)}")
    expect(balanceRowsSrc()).not.toContain("selectedKey")
    expect(balanceRowsSrc()).not.toContain("onSelectKey")
  })

  it("Bitcoin appears in Overview, Details, Withdraw, and Activity as a unified PineTree rail", () => {
    expect(walletPage).toContain('label: "Bitcoin" as const')
    expect(walletPage).toContain('pendingBalance("BTC", "bitcoin", "BTC", "bitcoin_lightning", "speed", 8)')
    expect(walletPage).toContain('bitcoin: ["BTC"]')
    expect(walletPage).toContain('railDisplayName(item.rail)')
    expect(walletPage).toContain('return "Bitcoin"')
    expect(walletPage).not.toContain("/api/wallets/speed")
  })
})

describe("Withdraw tab - dropdown asset selector and soft validation states", () => {
  it("WithdrawalFormShell renders AssetSelectDropdown, not stacked asset cards", () => {
    const src = withdrawalFormSrc()
    expect(src).toContain("AssetSelectDropdown")
    expect(src).not.toContain("grid-cols-3")
  })

  it("Withdraw asset dropdown maps assetOptions with railLabel/balanceLabel/usdLabel", () => {
    const src = withdrawalFormSrc()
    expect(src).toContain("assetOptions.map")
    expect(src).toContain("railLabel")
    expect(src).toContain("balanceLabel")
    expect(src).toContain("usdLabel")
  })

  it("Withdraw helper copy is wallet-asset based, not enabled-rail based", () => {
    const src = withdrawalFormSrc()
    expect(src).not.toContain("Choose an enabled PineTree Wallet asset")
    expect(src).toContain("Balance will be verified before processing.")
  })

  it("Withdraw tab has no intro Send card above the asset selector", () => {
    const src = withdrawalFormSrc().replace(/\r\n/g, "\n")
    expect(src).not.toContain(">Send<")
    expect(src).not.toContain("Choose a PineTree Wallet asset, then review before approval.")
    // The default (non-review) screen opens straight into the asset selector.
    const formScreen = src.slice(src.lastIndexOf('return (\n    <div className="space-y-4">'))
    expect(formScreen.indexOf("AssetSelectDropdown")).toBeGreaterThan(-1)
    expect(formScreen.indexOf(">Send<")).toBe(-1)
  })

  it("withdraw auto-selects first wallet-backed asset and clears review state on change", () => {
    const withdrawableAssetOptionsSrc = walletPage.slice(
      walletPage.indexOf("const withdrawalWalletRows = useMemo(() => ["),
      walletPage.indexOf("}, [walletSync, withdrawalWalletRows])")
    )
    expect(walletPage).toContain("withdrawableAssetOptions[0]")
    expect(walletPage).toContain("const withdrawalWalletRows = useMemo(() => [")
    expect(withdrawableAssetOptionsSrc).toContain(".filter((row) => row.configured)")
    expect(withdrawableAssetOptionsSrc).not.toContain(".filter((row) => row.configured && row.enabled)")
    expect(walletPage).toContain("handleWithdrawalAssetSelect")
    expect(walletPage).toContain("setWithdrawalReview(null)")
    expect(walletPage).toContain("setWithdrawalSubmitResult(null)")
    expect(walletPage).toContain('setWithdrawalScreen("form")')
  })

  it("withdraw tab uses isolated form, review, approving, submitted, and failed screens", () => {
    const src = withdrawalFormSrc()
    expect(walletPage).toContain('type WithdrawalScreen = "form" | "review" | "approving" | "submitted" | "failed"')
    expect(src).toContain('if (screen === "review" && review)')
    expect(src).toContain('if (screen === "approving")')
    expect(src).toContain('if (screen === "submitted" && submitResult)')
    expect(src).toContain('if (screen === "failed")')
    expect(src).toContain("Approving withdrawal")
    expect(src).toContain("Confirm this withdrawal in PineTree Wallet.")
    expect(src).toContain("Withdrawal failed")
    expect(src).toContain("Done")
    expect(src).not.toContain("primaryActionLabel")
    expect(src).not.toContain("onClick={primaryAction}")
    expect(src).not.toContain("Wallet approval")
    expect(src).not.toContain("Estimated status")
  })

  it("withdrawal review screen uses PineTree-styled review copy", () => {
    const src = withdrawalFormSrc()
    const reviewScreen = src.slice(
      src.indexOf('if (screen === "review" && review)'),
      src.indexOf('if (screen === "approving")')
    )
    expect(reviewScreen).toContain("rounded-[1.35rem]")
    expect(reviewScreen).toContain("border-blue-200/70")
    expect(reviewScreen).toContain("Review withdrawal")
    expect(reviewScreen).toContain("<dt")
    expect(reviewScreen).toContain(">Asset<")
    expect(reviewScreen).toContain(">Network<")
    expect(reviewScreen).toContain(">Amount<")
    expect(reviewScreen).toContain(">Destination<")
    expect(reviewScreen).toContain("Estimated network fee")
    expect(reviewScreen).toContain("Network fee may apply")
  })

  it("review screen has Approve withdrawal and a Back secondary action, not a generic browser-confirm layout", () => {
    const src = withdrawalFormSrc().replace(/\r\n/g, "\n")
    const reviewScreen = src.slice(
      src.indexOf('if (screen === "review" && review)'),
      src.indexOf('if (screen === "approving")')
    )
    expect(reviewScreen).toContain("{reviewActionLabel}")
    expect(reviewScreen).toContain(">\n            Back\n          </button>")
    expect(reviewScreen).toContain("onClick={() => onSubmit({ irreversibleAckChecked })}")
    expect(reviewScreen).toContain("onClick={onEdit}")
    expect(reviewScreen).toContain("flex-col gap-2 sm:flex-row")
    expect(reviewScreen).not.toContain("window.confirm")
  })

  it("withdrawal form uses a compact centered Review withdrawal action", () => {
    const src = withdrawalFormSrc()
    const actionBlock = src.slice(
      src.lastIndexOf('<div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">'),
      src.indexOf('{process.env.NODE_ENV !== "production" ? (')
    )

    expect(actionBlock).toContain("onClick={onReview}")
    expect(actionBlock).toContain('disabled={reviewDisabled}')
    expect(actionBlock).toContain('Review withdrawal')
    expect(actionBlock).toContain("min-w-[12rem]")
    expect(actionBlock).not.toContain("w-full")
  })

  it("withdraw validation and pending review states are not yellow warning blocks", () => {
    const src = withdrawalFormSrc().replace(/\r\n/g, "\n")
    const formScreen = src.slice(src.lastIndexOf('return (\n    <div className="space-y-4">'))
    expect(formScreen).not.toContain("border-amber")
    expect(formScreen).not.toContain("bg-amber")
    expect(formScreen).not.toContain("text-amber")
    expect(formScreen).toContain("border-blue-100")
    expect(formScreen).toContain("bg-blue-50")
    expect(formScreen).toContain("border-gray-200")
    expect(formScreen).toContain("bg-gray-50")
  })

  it("does not render the legacy Bitcoin Lightning payout card anywhere in the withdrawal form", () => {
    const src = withdrawalFormSrc()
    expect(src).not.toContain("Bitcoin Lightning payout")
    expect(src).not.toContain("Set Bitcoin payout destination")
    expect(src).not.toContain("showLightningPayoutSetup")
    expect(src).not.toContain("lightningPayout")
    // Confirms the removal is structural (the prop/type is gone), not just CSS-hidden.
    expect(walletPage).not.toContain("lightningPayoutSummary")
  })

  it("Transfer type renders immediately after the asset selector, with saved-destination chooser beneath it", () => {
    const src = withdrawalFormSrc()
    const assetSelectorIndex = src.indexOf("<AssetSelectDropdown")
    const transferTypeIndex = src.indexOf('<p className="text-xs font-semibold uppercase text-gray-500">Transfer type</p>')
    const savedDestinationIndex = src.indexOf("Choose Saved Destination</p>")
    const sendToIndex = src.indexOf('<p className="text-xs font-semibold uppercase text-gray-500">Paste New Address</p>')
    expect(assetSelectorIndex).toBeGreaterThan(-1)
    expect(transferTypeIndex).toBeGreaterThan(assetSelectorIndex)
    expect(savedDestinationIndex).toBeGreaterThan(transferTypeIndex)
    expect(sendToIndex).toBeGreaterThan(savedDestinationIndex)
  })

  it("saved destination selection is optional - no submission gate depends on it", () => {
    const src = withdrawalFormSrc()
    expect(src).not.toContain("missingDestination || missingAmount || amountParseError || invalidAmount || selectedBalanceZero || amountExceedsBalance || bitcoinBalanceUnavailable || !selectedDestinationId")
    expect(src).toContain("const reviewBlockedByInput = reviewing || noWithdrawableAssets || missingDestination || missingAmount || amountParseError || invalidAmount || selectedBalanceZero || amountExceedsBalance || bitcoinBalanceUnavailable")
  })
})

describe("Wallet setup card - connected rails and compact desktop layout", () => {
  it("wallet setup card keeps its width while using the slightly taller spacious layout", () => {
    const src = runtimeSrc()
    expect(src).not.toContain("min-h-[230px]")
    expect(src).not.toContain("sm:items-end")
    expect(src).not.toContain("sm:flex-row sm:items-start sm:justify-between")
    expect(src).toContain("min-h-[15rem]")
    expect(src).toContain("sm:min-h-[16rem]")
    expect(src).toContain("flex flex-col")
    expect(src).toContain("p-6")
    expect(src).toContain("sm:p-7")
    expect(src).toContain("max-w-2xl")
    expect(src).toContain("max-w-xl")
    expect(src).toContain("mt-7 max-w-xl")
    const setupActionIndex = src.indexOf('<div className="mt-auto flex justify-start pt-8">')
    const setupCardStart = src.indexOf('<article className="max-w-2xl')
    const setupCardEnd = src.indexOf("</article>", setupCardStart)
    expect(setupActionIndex).toBeGreaterThan(src.indexOf("<EnabledRailChips rows={walletRailRows} />"))
    expect(setupActionIndex).toBeLessThan(setupCardEnd)
  })

  it("front wallet card shows a simple centered summary without duplicating the modal overview", () => {
    const src = runtimeSrc()
    const setupCard = src.slice(
      src.indexOf("<article className=\"max-w-2xl"),
      src.indexOf("{/* Exactly one problem card renders")
    )
    const modalOverview = walletOverviewSrc()

    expect(setupCard).not.toContain("Wallet Balance")
    expect(walletPage).not.toContain("frontBalanceHidden")
    expect(setupCard).not.toContain("Last synced")
    expect(setupCard).toContain("<EnabledRailChips rows={walletRailRows} />")
    expect(setupCard).not.toContain(">TOTAL BALANCE</p>")
    expect(setupCard).not.toContain(">WALLET SUMMARY</p>")
    expect(setupCard).not.toContain("Recent withdrawals")
    expect(modalOverview).toContain(">TOTAL BALANCE</p>")
    expect(modalOverview).toContain(">WALLET SUMMARY</p>")
  })

  it("main Connected pill is removed from the wallet setup card header area", () => {
    const src = runtimeSrc()
    expect(src).toContain("<h2 className=\"min-w-0 text-base font-semibold text-gray-950\">PineTree Wallet</h2>")
    const setupCardHeader = src.slice(
      src.indexOf("<article className=\"max-w-2xl"),
      src.indexOf("{!walletProvisioningInProgress ? (")
    )
    expect(setupCardHeader).not.toContain("WalletStatusPill")
    expect(setupCardHeader).not.toContain("label={walletStatus}")
    expect(setupCardHeader).not.toContain("className=\"shrink-0\"")
  })

  it("wallet setup state still derives Connected internally when the wallet is set up", () => {
    expect(walletPage).toContain('walletSetupPrimaryState === "ready" ? "Connected" :')
    expect(walletPage).not.toContain('walletSetupPrimaryState === "ready" ? "Ready"')
    expect(walletPage).toContain('if (step === "profile_synced") return ""')
    expect(walletPage).not.toContain('if (step === "profile_synced") return "Wallet ready"')
  })

  it("wallet workspace has no duplicate internal title or page-level close control", () => {
    const workspaceLead = walletPage.slice(
      walletPage.indexOf('aria-label="PineTree Wallet workspace"'),
      walletPage.indexOf("activeView === null")
    )
    const pageComponent = walletPage.slice(walletPage.indexOf("export default function PineTreeWalletPage()"))
    expect(pageComponent).toContain('<h1 className={dashboardPageTitleClass}>PineTree Wallet</h1>')
    expect(workspaceLead).not.toContain("<header")
    expect(workspaceLead).not.toContain("<h2")
    expect(workspaceLead).not.toContain('aria-label="Close PineTree Wallet"')
    expect(workspaceLead).not.toContain("<X size=")
    expect(workspaceLead).not.toContain("WalletStatusPill")
    expect(workspaceLead).not.toContain("label={walletStatus}")
    expect(workspaceLead).not.toContain("One merchant wallet profile")
  })

  it("ready wallet launcher is removed while setup actions remain in the content flow", () => {
    const src = runtimeSrc()
    const setupCardStart = src.indexOf('<article className="max-w-2xl')
    const setupCard = src.slice(
      setupCardStart,
      src.indexOf("</article>", setupCardStart)
    )
    expect(src).toContain("directWalletOpenAttemptedRef")
    expect(src).toContain("void handleOpenWallet()")
    expect(src).toContain("showWalletSetupCard")
    expect(setupCard).not.toContain("Open PineTree Wallet")
    expect(setupCard).toContain("Create PineTree Wallet")
    expect(setupCard).toContain("onClick={handleCreateWallet}")
  })

  it("withdrawal form keeps reconnect handling out of the initial review action", () => {
    const formShell = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    const actionBlock = formShell.slice(
      formShell.lastIndexOf('<div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">'),
      formShell.indexOf('{process.env.NODE_ENV !== "production" ? (')
    )

    expect(actionBlock).toContain("onClick={onReview}")
    expect(actionBlock).toContain('Review withdrawal')
    expect(actionBlock).not.toContain("Reconnect PineTree Wallet")
    expect(formShell).not.toContain("missingRuntimeSigner")
  })

  it("EnabledRailChips renders Connected Networks label above active rail pills", () => {
    const chipsSrc = walletPage.slice(
      walletPage.indexOf("function EnabledRailChips("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(chipsSrc).toContain("Connected Networks")
    expect(chipsSrc).toContain("None connected yet")
    expect(chipsSrc).toContain("row.enabled && row.configured")
    expect(chipsSrc).toContain('aria-label="Enabled payment rails"')
  })

  it("Connected rails group only renders rail pills, not the main wallet status pill", () => {
    const chipsSrc = walletPage.slice(
      walletPage.indexOf("function EnabledRailChips("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(chipsSrc).toContain("{enabledRows.map((rail) => (")
    expect(chipsSrc).toContain("{rail.label}")
    expect(chipsSrc).not.toContain("ProviderStatusPill")
    expect(chipsSrc).not.toContain("walletStatus")
  })
})

describe("Dynamic email fallback modal branding", () => {
  it("uses the shared PineTree header logo asset for Dynamic auth branding", () => {
    expect(dynamicProvider).toContain('const pineTreeDynamicLogoUrl = "/favicon.ico"')
    expect(dynamicProvider).toContain("appLogoUrl: pineTreeDynamicLogoUrl")
    expect(dynamicProvider).toContain("cssOverrides: pineTreeDynamicCssOverrides")
    expect(dynamicProvider).toContain(".layout-header__typography img")
    expect(dynamicProvider).toContain("object-fit: contain")
    expect(dynamicProvider).not.toContain("blue circle checkmark")
  })
})

describe("Activity tab - recent withdrawal visibility", () => {
  function activityTabSrc() {
    return walletPage.slice(
      walletPage.indexOf("function ActivityTab("),
      walletPage.indexOf("// ---------------------------------------------------------------------------\n// Main runtime component")
    )
  }

  it("ActivityStatusPill and ActivityTab components are present in the page", () => {
    expect(walletPage).toContain("function ActivityStatusPill(")
    expect(walletPage).toContain("function ActivityTab(")
  })

  it("Activity tab renders recentActivity items from sync state", () => {
    const src = activityTabSrc()
    expect(src).toContain("recentActivity")
    expect(src).toContain("items.map")
    expect(src).toContain("activityAmountLabel(item)")
    expect(src).toContain("activityDestinationLabel(item)")
    expect(src).toContain("item.status")
    expect(src).toContain("item.createdAt")
  })

  it("Activity tab shows empty state when no activity exists", () => {
    const src = activityTabSrc()
    expect(src).toContain("No withdrawals yet.")
    expect(src).toContain("items.length === 0")
  })

  it("Activity row shows Solana/Base/Bitcoin network names, not the lowercase rail in parentheses", () => {
    const src = activityTabSrc()
    expect(src).toContain("railDisplayName(item.rail)")
    expect(src).toContain("formatActivityTimestamp(item.createdAt)")
    expect(walletPage).toContain('function railDisplayName(rail: WithdrawalRail) {')
    expect(walletPage).toContain('if (rail === "base") return "Base"')
    expect(walletPage).toContain('if (rail === "solana") return "Solana"')
  })

  it("Activity submits a fresh sync after a withdrawal is submitted, so it never shows a stale Pending row", () => {
    expect(walletPage).toContain('setWithdrawalScreen("submitted")')
    const pollFn = walletPage.slice(
      walletPage.indexOf("async function pollWithdrawalRequest"),
      walletPage.indexOf("async function handleSubmitWithdrawal")
    )
    expect(pollFn).toContain("void syncPineTreeWallet()")
    const submitFn = walletPage.slice(
      walletPage.indexOf("async function handleSubmitWithdrawal"),
      walletPage.indexOf("// ---------------------------------------------------------------------------\n  // Early returns")
    )
    expect(submitFn).toContain("void syncPineTreeWallet()")
  })

  it("ActivityStatusPill delegates to the shared merchant status contract", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function ActivityStatusPill("),
      walletPage.indexOf("function ActivityTab(")
    )
    expect(src).toContain("<StatusBadge status={status} />")
    expect(walletPage).toContain('import StatusBadge from "@/components/ui/StatusBadge"')
  })

  it("Activity workspace is wired to walletSync and walletSyncing props", () => {
    const src = walletPage.slice(
      walletPage.indexOf('activeView === "activity"'),
      walletPage.indexOf('activeView === "address-book"')
    )
    expect(src).toContain("walletSync")
    expect(src).toContain("walletSyncing")
  })

  it("Activity tab shows Syncing label while sync is in progress", () => {
    const src = activityTabSrc()
    expect(src).toContain("Syncing...")
    expect(src).toContain("syncing")
  })

  it("Activity rows open a merchant-safe withdrawal detail card with the shared modal structure", () => {
    const src = activityTabSrc()
    expect(src).toContain("openActivityDetail(item)")
    expect(src).toContain("Withdrawal details")
    expect(src).toContain('data-pinetree-overlay="true"')
    expect(src).toContain("pinetree-modal-backdrop")
    expect(src).toContain("Destination Address")
    expect(src).toContain("Transaction Hash")
    expect(src).toContain("View Explorer")
    expect(src).toContain("CopyableDetailValue")
    expect(src).not.toContain("<DetailRow label=\"Provider\"")
    expect(src).not.toContain("Provider Reference")
    expect(src).not.toContain("Withdrawal ID")
    expect(src).not.toContain("Settlement Reference")
    expect(src).not.toContain("Raw provider status")
    expect(src).not.toContain(">Advanced<")
    expect(src).not.toContain("Not completed")
  })
})

describe("Provider connected/not connected behavior", () => {
  it("wallet rail rows derive Connected status from configured && enabled", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })

  it("providers page uses Connected/Setup needed/Not connected for the crypto rail status pill, independent of enabled state", () => {
    // "Disabled" is a legitimate toggle label now, but the status pill union
    // still only ever resolves to Connected/Setup needed/Not connected.
    expect(providersPage).toContain('"Connected" | "Setup needed" | "Not connected"')
    expect(providersPage).toContain('const statusLabel = connected ? "Connected" : readiness ? "Setup needed" : "Not connected"')
  })
})
