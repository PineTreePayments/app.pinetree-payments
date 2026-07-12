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

describe("Overview tab - polished PineTree summary", () => {
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
    expect(src).toContain("grid-cols-[minmax(0,1fr)_7.25rem_minmax(4.5rem,auto)]")
    expect(src).toContain("sm:grid-cols-[minmax(0,1fr)_7.75rem_minmax(5.75rem,auto)]")
    expect(src).toContain("className=\"flex justify-center\"")
    expect(walletPage).toContain("w-[6.75rem] justify-center")
    expect(src).toContain("text-right")
  })

  it("PineTree Wallet status pills use compact wallet-local styling", () => {
    expect(walletPage).toContain("function WalletStatusPill")
    expect(walletPage).toContain("min-h-0 w-[6.75rem] justify-center px-3 py-1 text-center text-[11px] leading-none")
    expect(walletOverviewSrc()).toContain("WalletStatusPill")
    expect(runtimeSrc()).toContain("WalletStatusPill")
  })

  it("Overview only renders Total Balance and Wallet Summary wallet sections", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("TOTAL BALANCE")
    expect(src).toContain("WALLET SUMMARY")
    expect(src).not.toContain("Bitcoin Lightning payout")
    expect(src).not.toContain("Recent activity")
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

describe("Balances tab - compact selected asset detail", () => {
  it("BalanceRows uses selectedKey state with the shared asset dropdown", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("selectedKey")
    expect(src).toContain("setSelectedKey")
    expect(src).toContain("balanceOptions")
    expect(src).toContain("dropdownOptions")
    expect(src).toContain("AssetSelectDropdown")
    expect(src).toContain("onSelect={setSelectedKey}")
    expect(src).toContain('balanceOptions.find((row) => row.key === "BASE_ETH")')
    expect(src).not.toContain('["Deposit", "Withdraw", "History"].map')
    expect(src).not.toContain("allAssets.map((row, index)")
    expect(src).not.toContain("ChevronRight")
  })

  it("selected asset detail card shows balance, metadata, and wallet address", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("Balance")
    expect(src).toContain("formatBalance(selectedAsset.balance, selectedAsset.asset)")
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
    expect(walletPage).toContain('{ key: "BASE_USDC", rail: "base", asset: "USDC"')
    expect(walletPage).toContain('{ key: "SOLANA_USDC", rail: "solana", asset: "USDC"')
    const src = balanceRowsSrc()
    expect(src).toContain("key: row.key")
    expect(src).toContain("railLabel: assetRailLabel(row.rail)")
  })

  it("BTC is only included for the Bitcoin rail when a Bitcoin payout address exists", () => {
    const src = balanceRowsSrc()
    expect(walletPage).toContain('{ key: "BTC", rail: "bitcoin", asset: "BTC"')
    expect(src).toContain('if (profileAddresses.base.length > 0) rows.push(...(sync?.balances.base ?? []))')
    expect(src).toContain('if (profileAddresses.solana.length > 0) rows.push(...(sync?.balances.solana ?? []))')
    expect(src).toContain('if (bitcoinPayoutEntries.length > 0) rows.push(...(sync?.balances.bitcoin ?? []))')
    expect(src).toContain('if (row.rail === "bitcoin" && bitcoinPayoutEntries.length === 0) return false')
  })

  it("BalanceRows detail card does not render a Status field", () => {
    const src = balanceRowsSrc()
    expect(src).not.toContain(">Status<")
    expect(src).not.toContain("selectedRailConnected")
    expect(src).not.toContain("selectedRailRow")
    expect(src).not.toContain('"Disabled"')
    expect(src).not.toContain('"Needs setup"')
    expect(src).not.toContain('tone="amber"')
  })

  it("BTC wallet address can exist while BTC balance indexing remains pending", () => {
    const src = balanceRowsSrc()
    expect(walletPage).toContain("const bitcoinReady = railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(walletPage).not.toContain("const bitcoinReady = bitcoinPayoutEntries.length > 0")
    expect(src).toContain("bitcoinPayoutEntries[0]?.address")
    expect(src).toContain("formatBalance(row.balance, row.asset)")
    expect(walletPage).toContain('{ key: "BTC", rail: "bitcoin", asset: "BTC", balance: null')
    expect(src).toContain('if (row.rail === "bitcoin" && bitcoinPayoutEntries.length === 0) return false')
    expect(src).not.toContain("Speed")
  })

  it("Balances tab does not render Lightning settlement UI", () => {
    const balancesSection = walletPage.slice(
      walletPage.indexOf('activeTab === "balances"'),
      walletPage.indexOf('activeTab === "withdraw"')
    )
    expect(balancesSection).not.toContain("LightningSettlementPanel")
    expect(balanceRowsSrc()).not.toContain("Lightning settlement")
    expect(balanceRowsSrc()).not.toContain('asset: "LIGHTNING"')
    expect(balanceRowsSrc()).not.toContain("groups.map")
  })
})

describe("Wallets tab removed", () => {
  it("modal tabs include Overview, Balances, Withdraw, and Activity", () => {
    expect(walletPage).toContain('type WalletTab = "overview" | "balances" | "withdraw" | "activity"')
    expect(walletPage).toContain('{ id: "overview", label: "Overview" }')
    expect(walletPage).toContain('{ id: "balances", label: "Balances" }')
    expect(walletPage).toContain('{ id: "withdraw", label: "Withdraw" }')
    expect(walletPage).toContain('{ id: "activity", label: "Activity" }')
    expect(walletPage).toContain("grid-cols-4")
    expect(walletPage).not.toContain('label: "Wallets"')
    expect(walletPage).not.toContain('activeTab === "wallets"')
  })

  it("old wallet-row and receive-row components are gone", () => {
    expect(walletPage).not.toContain("function WalletRows(")
    expect(walletPage).not.toContain("function ReceiveRow(")
    expect(walletPage).not.toContain("LightningSettlementPanel")
  })

  it("Bitcoin Lightning payout is compact and PineTree-facing in Withdraw only", () => {
    const src = withdrawalFormSrc()
    expect(walletOverviewSrc()).not.toContain("Bitcoin Lightning payout")
    expect(src).toContain("Bitcoin Lightning payout")
    expect(src).toContain("Destination: {lightningPayout.destinationLabel}")
    expect(src).toContain('"PineTree BTC Wallet"')
    expect(src).toContain('"Not set"')
    expect(src).toContain("lightningPayout.connected ? \"Connected\" : \"Not connected\"")
    expect(src).toContain('const showLightningPayoutSetup = rail === "bitcoin" && asset === "BTC" && !lightningPayout.connected')
    expect(src).toContain("Set Bitcoin payout destination")
    expect(src).not.toContain("Speed")
    expect(src).not.toContain("Auto-settlement")
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

  it("Bitcoin Lightning payout does not render for Base or Solana withdrawal assets", () => {
    const src = withdrawalFormSrc()
    const showLightningLine = src
      .split("\n")
      .find((line) => line.includes("const showLightningPayoutSetup")) || ""
    expect(showLightningLine).toContain('rail === "bitcoin" && asset === "BTC" && !lightningPayout.connected')
    expect(showLightningLine).not.toContain('rail === "base"')
    expect(showLightningLine).not.toContain('rail === "solana"')
  })

  it("withdraw auto-selects first wallet-backed asset and clears review state on change", () => {
    expect(walletPage).toContain("withdrawableAssetOptions[0]")
    expect(walletPage).toContain("const withdrawalWalletRows = useMemo(() => [")
    expect(walletPage).toContain(".filter((row) => row.configured)")
    expect(walletPage).not.toContain(".filter((row) => row.configured && row.enabled)")
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
    expect(reviewScreen).toContain("onClick={onSubmit}")
    expect(reviewScreen).toContain("onClick={onEdit}")
    expect(reviewScreen).toContain("flex-col gap-2 sm:flex-row")
    expect(reviewScreen).not.toContain("window.confirm")
  })

  it("withdrawal form uses a compact centered Review withdrawal action", () => {
    const src = withdrawalFormSrc()
    const reviewButton = src.slice(
      src.indexOf("onClick={missingRuntimeSigner && onFinishSetup ? onFinishSetup : onReview}"),
      src.indexOf('{reviewing ? "Reviewing..."')
    )

    expect(reviewButton).toContain("inline-flex h-11 min-w-[12rem]")
    expect(reviewButton).toContain("px-6")
    expect(reviewButton).not.toContain("w-full")
    expect(src).toContain("flex flex-col items-center gap-2 sm:flex-row sm:justify-center")
  })

  it("withdraw validation and pending review states are not yellow warning blocks", () => {
    const src = withdrawalFormSrc()
    expect(src).not.toContain("border-amber")
    expect(src).not.toContain("bg-amber")
    expect(src).not.toContain("text-amber")
    expect(src).toContain("border-blue-100")
    expect(src).toContain("bg-blue-50")
    expect(src).toContain("border-gray-200")
    expect(src).toContain("bg-gray-50")
  })
})

describe("Wallet setup card - connected rails and compact desktop layout", () => {
  it("wallet setup card avoids the old tall stretched layout", () => {
    const src = runtimeSrc()
    expect(src).not.toContain("min-h-[230px]")
    expect(src).not.toContain("sm:items-end")
    expect(src).not.toContain("sm:flex-row sm:items-start sm:justify-between")
    expect(src).toContain("p-5")
    expect(src).toContain("sm:p-6")
    expect(src).toContain("max-w-2xl")
    expect(src).toContain("max-w-xl")
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

  it("wallet modal header badge also displays Connected instead of Ready", () => {
    const labelUsages = [...walletPage.matchAll(/label=\{walletStatus\}/g)]
    expect(labelUsages.length).toBeGreaterThanOrEqual(1)
    const modalHeader = walletPage.slice(
      walletPage.indexOf('aria-labelledby="pinetree-wallet-modal-title"'),
      walletPage.indexOf('aria-label="Close PineTree Wallet"')
    )
    expect(modalHeader).toContain("label={walletStatus}")
  })

  it("Open/Create PineTree Wallet button remains in the content flow", () => {
    const src = runtimeSrc()
    expect(src).toContain("Open PineTree Wallet")
    expect(src).toContain("Create PineTree Wallet")
    expect(src).toContain("mt-6 flex justify-start")
  })

  it("EnabledRailChips renders Connected rails label above active rail pills", () => {
    const chipsSrc = walletPage.slice(
      walletPage.indexOf("function EnabledRailChips("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(chipsSrc).toContain("Connected rails")
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
    expect(src).toContain("item.label")
    expect(src).toContain("item.status")
    expect(src).toContain("item.createdAt")
  })

  it("Activity tab shows empty state when no activity exists", () => {
    const src = activityTabSrc()
    expect(src).toContain("No wallet activity yet.")
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
      walletPage.indexOf("async function handleSubmitWithdrawal()")
    )
    expect(pollFn).toContain("void syncPineTreeWallet()")
    const submitFn = walletPage.slice(
      walletPage.indexOf("async function handleSubmitWithdrawal()"),
      walletPage.indexOf("// ---------------------------------------------------------------------------\n  // Early returns")
    )
    expect(submitFn).toContain("void syncPineTreeWallet()")
  })

  it("ActivityStatusPill renders Confirmed status in blue", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function ActivityStatusPill("),
      walletPage.indexOf("function ActivityTab(")
    )
    expect(src).toContain("Confirmed")
    expect(src).toContain("bg-blue-100")
    expect(src).toContain("text-blue-700")
  })

  it("ActivityStatusPill renders Failed status", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function ActivityStatusPill("),
      walletPage.indexOf("function ActivityTab(")
    )
    expect(src).toContain("Failed")
    expect(src).toContain("text-red-600")
  })

  it("ActivityStatusPill renders Sent, Confirmed, Canceled, Blocked, and Pending statuses", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function ActivityStatusPill("),
      walletPage.indexOf("function ActivityTab(")
    )
    expect(src).toContain('s === "sent" || s === "processing" ? "Sent"')
    expect(src).toContain("Confirmed")
    expect(src).toContain("Canceled")
    expect(src).toContain("Blocked")
    expect(src).toContain("Pending")
  })

  it("Activity tab is wired to walletSync and walletSyncing props", () => {
    const src = walletPage.slice(
      walletPage.indexOf('activeTab === "activity"'),
      walletPage.indexOf("activeTab === \"activity\"") + 200
    )
    expect(src).toContain("walletSync")
    expect(src).toContain("walletSyncing")
  })

  it("Activity tab shows Syncing label while sync is in progress", () => {
    const src = activityTabSrc()
    expect(src).toContain("Syncing...")
    expect(src).toContain("syncing")
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
