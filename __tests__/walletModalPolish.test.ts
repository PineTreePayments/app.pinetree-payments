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
// 3-7 — Balances tab: asset-selector pattern
// ---------------------------------------------------------------------------

describe("Balances tab — asset-selector view", () => {
  it("BalanceRows uses selectedKey state for asset selection", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("selectedKey")
    expect(src).toContain("setSelectedKey")
  })

  it("BalanceRows renders all assets as selectable buttons with blue selected state", () => {
    const src = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(src).toContain("border-blue-300 bg-blue-50")
    expect(src).toContain("onClick={() => setSelectedKey(row.key)}")
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

  it("wallets tab renders LightningSettlementPanel as compact payout row", () => {
    const walletsSection = walletPage.slice(
      walletPage.indexOf('activeTab === "wallets"'),
      walletPage.indexOf('activeTab === "withdraw"')
    )
    expect(walletsSection).toContain("LightningSettlementPanel")
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
// 14-15 — Withdraw tab: default asset selection and single primary button
// ---------------------------------------------------------------------------

describe("Withdraw tab — default asset and single primary button", () => {
  it("withdraw auto-selects first enabled asset (never defaults to disabled rail)", () => {
    // The useEffect selects withdrawableAssetOptions[0] when current selection is no longer valid
    expect(walletPage).toContain("withdrawableAssetOptions[0]")
    // withdrawableAssetOptions filters for row.configured && row.enabled
    expect(walletPage).toContain(".filter((row) => row.configured && row.enabled)")
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
// 16 — Provider connected/not connected behavior preserved
// ---------------------------------------------------------------------------

describe("Provider connected/not connected behavior", () => {
  it("wallet rail rows derive Connected status from configured && enabled", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })

  it("solana status in wallets tab uses solanaReady && enabledRails.solana", () => {
    expect(walletPage).toContain('solanaReady && enabledRails.solana ? "Connected" : "Not connected"')
  })

  it("bitcoin status in wallets tab uses bitcoinReady && enabledRails.bitcoin", () => {
    expect(walletPage).toContain('bitcoinReady && enabledRails.bitcoin ? "Connected" : "Not connected"')
  })

  it("providers page uses Connected/Not connected (no Disabled pill) for crypto rails", () => {
    expect(providersPage).not.toContain('"Disabled"')
    expect(providersPage).toContain('"Connected" : "Not connected"')
  })
})
