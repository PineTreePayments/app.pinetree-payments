import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

const walletPage = read("app/dashboard/wallet-setup/page.tsx")
const providersPage = read("app/dashboard/providers/page.tsx")

function walletOverviewSrc() {
  return walletPage.slice(
    walletPage.indexOf("function WalletOverviewSummary("),
    walletPage.indexOf("function AssetSelectDropdown(")
  )
}

function dropdownSrc() {
  return walletPage.slice(
    walletPage.indexOf("function AssetSelectDropdown("),
    walletPage.indexOf("function BalanceRows(")
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
    expect(src).toContain("radial-gradient")
    expect(src).toContain("border-blue-")
    expect(src).toContain("shadow-[0_22px_50px")
  })

  it("renders Wallet Summary with blue-tinted border and divider", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("WALLET SUMMARY")
    expect(src).toContain("border-blue-200")
    expect(src).toContain("border-b border-blue-")
  })

  it("shows Last synced or Pending sync copy", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("Last synced")
    expect(src).toContain("Pending sync")
  })

  it("rail summary rows use configured && enabled for Connected / Not connected", () => {
    const src = walletOverviewSrc()
    expect(src).toContain("row.configured && row.enabled")
    expect(src).toContain('"Connected" : "Not connected"')
    expect(src).not.toContain('"Disabled"')
  })
})

describe("Balances tab - dropdown asset selector and wallet detail", () => {
  it("BalanceRows uses selectedKey state and AssetSelectDropdown", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("selectedKey")
    expect(src).toContain("setSelectedKey")
    expect(src).toContain("AssetSelectDropdown")
    expect(src).toContain("dropdownOptions")
    expect(src).not.toContain("onClick={() => setSelectedKey(row.key)}")
  })

  it("AssetSelectDropdown uses PineTree blue selected-item styling", () => {
    const src = dropdownSrc()
    expect(src).toContain("bg-blue-50")
    expect(src).toContain("border-blue-")
    expect(src).toContain("isSelected")
  })

  it("selected asset detail card shows balance, USD estimate, metadata, and wallet address", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("Available balance")
    expect(src).toContain("formatBalance(selectedAsset.balance, selectedAsset.asset)")
    expect(src).toContain("formatUsd(selectedAsset.usdValue)")
    expect(src).toContain("Network")
    expect(src).toContain("Status")
    expect(src).toContain("Last synced")
    expect(src).toContain("Wallet address")
    expect(src).toContain('aria-label="Copy wallet address"')
  })

  it("BalanceRows selects the wallet address from the correct rail", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("profileAddresses.base[0]?.address")
    expect(src).toContain("profileAddresses.solana[0]?.address")
    expect(src).toContain("bitcoinPayoutEntries[0]?.address")
  })

  it("BalanceRows detail status uses Connected/Not connected with no yellow setup states", () => {
    const src = balanceRowsSrc()
    expect(src).toContain("selectedRailRow?.configured && selectedRailRow?.enabled")
    expect(src).toContain('"Connected" : "Not connected"')
    expect(src).not.toContain('"Disabled"')
    expect(src).not.toContain('"Needs setup"')
    expect(src).not.toContain('tone="amber"')
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
  it("modal has only Overview, Balances, and Withdraw tabs", () => {
    expect(walletPage).toContain('type WalletTab = "overview" | "balances" | "withdraw"')
    expect(walletPage).toContain('{ id: "overview", label: "Overview" }')
    expect(walletPage).toContain('{ id: "balances", label: "Balances" }')
    expect(walletPage).toContain('{ id: "withdraw", label: "Withdraw" }')
    expect(walletPage).toContain("grid-cols-3")
    expect(walletPage).not.toContain('label: "Wallets"')
    expect(walletPage).not.toContain('activeTab === "wallets"')
  })

  it("old wallet-row and receive-row components are gone", () => {
    expect(walletPage).not.toContain("function WalletRows(")
    expect(walletPage).not.toContain("function ReceiveRow(")
    expect(walletPage).not.toContain("LightningSettlementPanel")
    expect(walletPage).not.toContain("Bitcoin Lightning payout")
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

  it("withdraw auto-selects first enabled asset and clears review state on change", () => {
    expect(walletPage).toContain("withdrawableAssetOptions[0]")
    expect(walletPage).toContain(".filter((row) => row.configured && row.enabled)")
    expect(walletPage).toContain("handleWithdrawalAssetSelect")
    expect(walletPage).toContain("setWithdrawalReview(null)")
    expect(walletPage).toContain("setWithdrawalSubmitResult(null)")
  })

  it("withdraw tab keeps one progressive primary button", () => {
    const src = withdrawalFormSrc()
    expect(src).toContain("primaryActionLabel")
    expect(src).toContain("primaryAction")
    const buttonMatches = (src.match(/onClick={primaryAction}/g) || []).length
    expect(buttonMatches).toBe(1)
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
    expect(src).toContain("p-5")
    expect(src).toContain("sm:p-6")
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
})

describe("Provider connected/not connected behavior", () => {
  it("wallet rail rows derive Connected status from configured && enabled", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })

  it("providers page uses Connected/Not connected with no Disabled pill for crypto rails", () => {
    expect(providersPage).not.toContain('"Disabled"')
    expect(providersPage).toContain('"Connected" : "Not connected"')
  })
})
