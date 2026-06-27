import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

const walletPage = read("app/dashboard/wallet-setup/page.tsx")
const providersPage = read("app/dashboard/providers/page.tsx")

// ---------------------------------------------------------------------------
// 1 & 2 — Overview tab: total balance hero + compact rail summary
// ---------------------------------------------------------------------------

describe("Overview tab — polished hero and compact rail summary", () => {
  it("renders total balance hero card with premium blue gradient", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function BalanceRows(")
    )
    expect(overviewSrc).toContain("Total balance")
    expect(overviewSrc).toContain("from-blue-50")
  })

  it("WalletOverviewSummary shows Last synced timestamp", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function BalanceRows(")
    )
    expect(overviewSrc).toContain("Last synced")
    expect(overviewSrc).toContain("Pending sync")
  })

  it("rail summary rows use configured && enabled for Connected / Not connected", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })

  it("disabled Solana shows Not connected — no yellow Disabled pill in overview", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function BalanceRows(")
    )
    expect(overviewSrc).not.toContain('"Disabled"')
    expect(overviewSrc).toContain('"Not connected"')
  })
})

// ---------------------------------------------------------------------------
// 3-7 — Balances tab: dropdown asset selector
// ---------------------------------------------------------------------------

describe("Balances tab — dropdown asset selector", () => {
  it("BalanceRows uses selectedKey state for asset selection", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("selectedKey")
    expect(src).toContain("setSelectedKey")
  })

  it("BalanceRows renders AssetSelectDropdown (not a button grid)", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("AssetSelectDropdown")
    expect(src).toContain("dropdownOptions")
    // No old button-grid per-asset onClick handler
    expect(src).not.toContain("onClick={() => setSelectedKey(row.key)}")
  })

  it("AssetSelectDropdown uses blue highlight for selected item", () => {
    const dropdownSrc = walletPage.slice(
      walletPage.indexOf("function AssetSelectDropdown("),
      walletPage.indexOf("function BalanceRows(")
    )
    expect(dropdownSrc).toContain("bg-blue-50")
    expect(dropdownSrc).toContain("isSelected")
  })

  it("BalanceRows detail card shows Status field as Connected/Not connected pill (no yellow)", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("selectedRailConnected")
    expect(src).toContain('"Connected" : "Not connected"')
    expect(src).not.toContain('"Disabled"')
    expect(src).not.toContain('"Needs setup"')
  })

  it("Balances tab does not render LightningSettlementPanel", () => {
    const balancesSection = walletPage.slice(
      walletPage.indexOf('activeTab === "balances"'),
      walletPage.indexOf('activeTab === "wallets"')
    )
    expect(balancesSection).not.toContain("LightningSettlementPanel")
  })

  it("Balances tab does not show Bitcoin Lightning settlement as an asset", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).not.toContain("Lightning settlement")
    expect(src).not.toContain('asset: "LIGHTNING"')
  })

  it("BalanceRows does not render duplicate Bitcoin group cards", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    // Old stacked-card pattern used groups array; new pattern uses allAssets flat array
    expect(src).not.toContain("groups.map")
  })

  it("selected asset detail card shows crypto balance with USD estimate", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("Available balance")
    expect(src).toContain("formatBalance(selectedAsset.balance, selectedAsset.asset)")
    expect(src).toContain("≈")
    expect(src).toContain("formatUsd(selectedAsset.usdValue)")
  })

  it("BTC pending sync shows via formatBalance returning Pending sync, not as duplicate card", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    // formatBalance returns "Pending sync" when balance is null
    expect(src).toContain("Pending sync")
    // But no separate duplicate Bitcoin group card is rendered
    expect(src).not.toContain('title: "Bitcoin"')
  })
})

// ---------------------------------------------------------------------------
// 8-13 — Wallets tab: compact wallet address rows + Lightning payout row
// ---------------------------------------------------------------------------

describe("Wallets tab — wallet addresses and Lightning payout row", () => {
  it("wallets tab renders Base wallet, Solana wallet, Bitcoin wallet address rows", () => {
    expect(walletPage).toContain("Base wallet")
    expect(walletPage).toContain("Solana wallet")
    expect(walletPage).toContain("Bitcoin wallet")
  })

  it("wallets tab renders WalletRows dropdown view (not stacked ReceiveRow cards)", () => {
    const walletsSection = walletPage.slice(
      walletPage.indexOf('activeTab === "wallets"'),
      walletPage.indexOf('activeTab === "withdraw"')
    )
    expect(walletsSection).toContain("WalletRows")
    expect(walletsSection).not.toContain("<ReceiveRow")
  })

  it("compact payout row title is Bitcoin Lightning payout (not a big settlement card)", () => {
    expect(walletPage).toContain("Bitcoin Lightning payout")
  })

  it("wallets tab does not show Powered by Speed or Managed by Speed", () => {
    expect(walletPage).not.toContain("Powered by Speed")
    expect(walletPage).not.toContain("Managed by Speed")
  })

  it("LightningSettlementPanel does not show Auto-settlement, Last settlement, No settlements yet, or Needs setup", () => {
    const panelSrc = walletPage.slice(
      walletPage.indexOf("function LightningSettlementPanel("),
      walletPage.indexOf("function settlementStatusLabel(")
    )
    expect(panelSrc).not.toContain("Auto-settlement")
    expect(panelSrc).not.toContain("Last settlement")
    expect(panelSrc).not.toContain("No settlements yet")
    expect(panelSrc).not.toContain('"Needs setup"')
  })

  it("Lightning payout row shows PineTree BTC Wallet as destination label when configured", () => {
    const panelSrc = walletPage.slice(
      walletPage.indexOf("function LightningSettlementPanel("),
      walletPage.indexOf("function settlementStatusLabel(")
    )
    expect(panelSrc).toContain("PineTree BTC Wallet")
  })

  it("Lightning payout row shows Not set when no active destination", () => {
    const panelSrc = walletPage.slice(
      walletPage.indexOf("function LightningSettlementPanel("),
      walletPage.indexOf("function settlementStatusLabel(")
    )
    expect(panelSrc).toContain('"Not set"')
    expect(panelSrc).toContain('settlementConnected ? "Connected" : "Not connected"')
  })
})

// ---------------------------------------------------------------------------
// 14-15 — Withdraw tab: dropdown asset selector and single primary button
// ---------------------------------------------------------------------------

describe("Withdraw tab — dropdown asset selector and single primary button", () => {
  it("WithdrawalFormShell renders AssetSelectDropdown (not stacked asset cards)", () => {
    const formSrc = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    expect(formSrc).toContain("AssetSelectDropdown")
    expect(formSrc).not.toContain("grid-cols-3")
  })

  it("Withdraw asset dropdown maps assetOptions with railLabel/balanceLabel/usdLabel", () => {
    const formSrc = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    expect(formSrc).toContain("assetOptions.map")
    expect(formSrc).toContain("railLabel")
    expect(formSrc).toContain("balanceLabel")
    expect(formSrc).toContain("usdLabel")
  })

  it("Withdraw shows empty-state message when no enabled rails (no stacked cards)", () => {
    const formSrc = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    expect(formSrc).toContain("Connect and enable a PineTree Wallet rail")
  })

  it("withdraw auto-selects first enabled asset (never defaults to disabled rail)", () => {
    // The useEffect selects withdrawableAssetOptions[0] when current selection is no longer valid
    expect(walletPage).toContain("withdrawableAssetOptions[0]")
    // withdrawableAssetOptions filters for row.configured && row.enabled
    expect(walletPage).toContain(".filter((row) => row.configured && row.enabled)")
  })

  it("changing withdraw asset clears review and submit state", () => {
    expect(walletPage).toContain("handleWithdrawalAssetSelect")
    expect(walletPage).toContain("setWithdrawalReview(null)")
    expect(walletPage).toContain("setWithdrawalSubmitResult(null)")
  })

  it("withdraw tab keeps one progressive primary button", () => {
    const formSrc = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    // Single progressive action label
    expect(formSrc).toContain("primaryActionLabel")
    expect(formSrc).toContain("primaryAction")
    // Only one primary submit button (not multiple stacked actions)
    const buttonMatches = (formSrc.match(/onClick={primaryAction}/g) || []).length
    expect(buttonMatches).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Yellow pill removal — no Disabled/Needs setup inside wallet modal tabs
// ---------------------------------------------------------------------------

describe("No yellow pills inside PineTree Wallet modal tabs", () => {
  it("ReceiveRow uses Connected/Not connected pills only (no amber)", () => {
    const receiveSrc = walletPage.slice(
      walletPage.indexOf("function ReceiveRow("),
      walletPage.indexOf("function WithdrawalFormShell(")
    )
    expect(receiveSrc).toContain('"Connected" : "Not connected"')
    expect(receiveSrc).not.toContain('tone="amber"')
    expect(receiveSrc).not.toContain('"Disabled"')
    expect(receiveSrc).not.toContain('"Needs setup"')
  })

  it("LightningSettlementPanel uses Connected/Not connected pills only (no amber)", () => {
    const panelSrc = walletPage.slice(
      walletPage.indexOf("function LightningSettlementPanel("),
      walletPage.indexOf("function settlementStatusLabel(")
    )
    expect(panelSrc).toContain('settlementConnected ? "Connected" : "Not connected"')
    expect(panelSrc).toContain('settlementConnected ? "blue" : "default"')
    expect(panelSrc).not.toContain('"amber"')
    expect(panelSrc).not.toContain('"Disabled"')
    expect(panelSrc).not.toContain('"Needs setup"')
  })

  it("BalanceRows detail card does not show yellow Disabled or Needs setup pill", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).not.toContain('"Disabled"')
    expect(src).not.toContain('"Needs setup"')
    expect(src).not.toContain('tone="amber"')
  })
})

// ---------------------------------------------------------------------------
// Wallet setup card — desktop layout correctness
// ---------------------------------------------------------------------------

describe("Wallet setup card — single-column compact layout", () => {
  it("wallet setup card does not use the old stretched two-column layout", () => {
    const cardSrc = walletPage.slice(
      walletPage.indexOf("function PineTreeWalletRuntime("),
      walletPage.indexOf("function PineTreeWalletPage(")
    )
    // Old layout: min-h-[230px] made the card unnecessarily tall on desktop
    expect(cardSrc).not.toContain("min-h-[230px]")
    // Old layout: sm:flex-row sm:items-start sm:justify-between put button far right
    expect(cardSrc).not.toContain("sm:flex-row sm:items-start sm:justify-between")
  })

  it("Open/Create PineTree Wallet button is in the content flow (not a right-aligned column)", () => {
    const cardSrc = walletPage.slice(
      walletPage.indexOf("function PineTreeWalletRuntime("),
      walletPage.indexOf("function PineTreeWalletPage(")
    )
    // Old layout: sm:items-end pushed button to far right
    expect(cardSrc).not.toContain("sm:items-end")
    // Button is present and in single-column content flow
    expect(cardSrc).toContain("Open PineTree Wallet")
    expect(cardSrc).toContain("Create PineTree Wallet")
  })
})

// ---------------------------------------------------------------------------
// Overview tab — Wallet Summary PineTree blue treatment
// ---------------------------------------------------------------------------

describe("Overview tab — Wallet Summary blue treatment", () => {
  it("Wallet Summary card uses blue-tinted border (not plain gray)", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function AssetSelectDropdown(")
    )
    expect(overviewSrc).toContain("Wallet summary")
    // Card container must use a blue border class
    expect(overviewSrc).toContain("border-blue-")
  })

  it("Wallet Summary header row uses blue-tinted divider, not plain gray", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function AssetSelectDropdown(")
    )
    // border-b should be blue, not just border-gray-100
    expect(overviewSrc).toContain("border-b border-blue-")
  })

  it("Total Balance card uses PineTree blue gradient (from-blue-50 family)", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function AssetSelectDropdown(")
    )
    expect(overviewSrc).toContain("Total balance")
    expect(overviewSrc).toContain("from-blue-50")
    expect(overviewSrc).toContain("border-blue-")
  })
})

// ---------------------------------------------------------------------------
// Withdraw tab — Send header
// ---------------------------------------------------------------------------

describe("Withdraw tab — Send header and subtitle", () => {
  it("WithdrawalFormShell has a Send heading with descriptive subtitle", () => {
    const formSrc = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    expect(formSrc).toContain("Choose an enabled PineTree Wallet asset")
  })
})

// ---------------------------------------------------------------------------
// Connected rails label on wallet setup card
// ---------------------------------------------------------------------------

describe("Connected rails label on wallet setup card", () => {
  it("EnabledRailChips renders Connected rails label above the pills", () => {
    const chipsSrc = walletPage.slice(
      walletPage.indexOf("function EnabledRailChips("),
      walletPage.indexOf("function WalletRows(")
    )
    expect(chipsSrc).toContain("Connected rails")
  })

  it("EnabledRailChips shows None connected yet for empty state", () => {
    const chipsSrc = walletPage.slice(
      walletPage.indexOf("function EnabledRailChips("),
      walletPage.indexOf("function WalletRows(")
    )
    expect(chipsSrc).toContain("None connected yet")
  })

  it("EnabledRailChips only shows connected (enabled && configured) rails as pills", () => {
    const chipsSrc = walletPage.slice(
      walletPage.indexOf("function EnabledRailChips("),
      walletPage.indexOf("function WalletRows(")
    )
    expect(chipsSrc).toContain("row.enabled && row.configured")
    expect(chipsSrc).toContain('aria-label="Enabled payment rails"')
  })
})

// ---------------------------------------------------------------------------
// Wallets tab — WalletRows dropdown view
// ---------------------------------------------------------------------------

describe("Wallets tab — WalletRows dropdown view", () => {
  it("WalletRows renders AssetSelectDropdown with Wallet label", () => {
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain('"Wallet"')
    expect(walletRowsSrc).toContain("AssetSelectDropdown")
  })

  it("WalletRows renders ReceiveRow with explicit label props for each wallet", () => {
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain('label="Base wallet"')
    expect(walletRowsSrc).toContain('label="Solana wallet"')
    expect(walletRowsSrc).toContain('label="Bitcoin wallet"')
  })

  it("WalletRows renders LightningSettlementPanel as compact secondary payout row", () => {
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain("LightningSettlementPanel")
  })

  it("WalletRows shows wallet address and copy button via ReceiveRow (copiedAddress/onCopy)", () => {
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain("onCopy")
    expect(walletRowsSrc).toContain("copiedAddress")
  })

  it("WalletRows derives status from row.configured && row.enabled so disabled rails show Not connected", () => {
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain("railStatus")
    expect(walletRowsSrc).toContain("row.configured && row.enabled")
  })

  it("Bitcoin Lightning payout is compact secondary row in WalletRows, not a wallet dropdown option", () => {
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    // Lightning is not a wallet dropdown key
    expect(walletRowsSrc).not.toContain('"lightning"')
    expect(walletRowsSrc).not.toContain('"Lightning wallet"')
    // It is rendered as LightningSettlementPanel
    expect(walletRowsSrc).toContain("LightningSettlementPanel")
  })
})

// ---------------------------------------------------------------------------
// Balances tab — wallet address in detail card
// ---------------------------------------------------------------------------

describe("Balances tab — wallet address in detail card", () => {
  it("BalanceRows detail card shows wallet address with copy button", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("Wallet address")
    expect(src).toContain("walletAddress")
    expect(src).toContain("onCopy")
    expect(src).toContain("copiedAddress")
  })

  it("BalanceRows walletAddress selects address from the correct rail profileAddresses entry", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("profileAddresses.base[0]?.address")
    expect(src).toContain("profileAddresses.solana[0]?.address")
    expect(src).toContain("bitcoinPayoutEntries[0]?.address")
  })
})

// ---------------------------------------------------------------------------
// 16 — Provider connected/not connected behavior preserved
// ---------------------------------------------------------------------------

describe("Provider connected/not connected behavior", () => {
  it("wallet rail rows derive Connected status from configured && enabled", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })

  it("solana status in wallets tab is derived from rail row configured && enabled (via WalletRows railStatus)", () => {
    // WalletRows derives wallet status through railStatus() which checks row.configured && row.enabled
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain("row.configured && row.enabled")
    expect(walletRowsSrc).toContain('"Connected" : "Not connected"')
  })

  it("bitcoin status in wallets tab is derived from rail row configured && enabled (via WalletRows railStatus)", () => {
    // Same railStatus() function handles all three rails including Bitcoin
    const walletRowsSrc = walletPage.slice(
      walletPage.indexOf("function WalletRows("),
      walletPage.indexOf("function PineTreeWalletRuntime(")
    )
    expect(walletRowsSrc).toContain("row.configured && row.enabled")
  })

  it("providers page uses Connected/Not connected (no Disabled pill) for crypto rails", () => {
    expect(providersPage).not.toContain('"Disabled"')
    expect(providersPage).toContain('"Connected" : "Not connected"')
  })
})
