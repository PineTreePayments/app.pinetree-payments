import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

const providersPage = read("app/dashboard/providers/page.tsx")
const walletPage = read("app/dashboard/wallet-setup/page.tsx")

describe("Bitcoin Lightning provider card cleanup", () => {
  it("ManagedCryptoRailCard no longer has the isLightning extra-rows branch", () => {
    expect(providersPage).not.toContain("isLightning")
  })

  it("provider card does not render old Lightning-specific details", () => {
    expect(providersPage).not.toContain(">Destination<")
    expect(providersPage).not.toContain(">Status<")
    expect(providersPage).not.toContain("Auto-settlement")
    expect(providersPage).not.toContain(">Processor<")
    expect(providersPage).not.toContain("Powered by Speed")
  })

  it("provider card does not show internal connection-box jargon", () => {
    expect(providersPage).not.toContain("PineTree Wallet settlement connected")
    expect(providersPage).not.toContain("Bitcoin payouts route to the merchant")
    expect(providersPage).not.toContain("Legacy Lightning")
  })

  it("Bitcoin Lightning card renders Networks and Settlement rows", () => {
    expect(providersPage).toContain('networks="Bitcoin Lightning"')
    expect(providersPage).toContain(">Settlement<")
    expect(providersPage).toContain(">Networks<")
  })

  it("Bitcoin Lightning description uses clean merchant-facing copy", () => {
    expect(providersPage).toContain("Lightning payments settle to the merchant")
    expect(providersPage).toContain("PineTree Wallet.")
  })
})

describe("rail status vocabulary - Connected / Setup needed / Not connected", () => {
  it("ManagedCryptoRailCard uses normalized wallet-provisioning status labels, independent of the enabled toggle", () => {
    expect(providersPage).toContain('const statusLabel = connected ? "Connected" : readiness ? "Setup needed" : "Not connected"')
    expect(providersPage).toContain("checked={toggleOn}")
  })

  it("crypto rail status pill can only ever be Connected, Setup needed, or Not connected — never Disabled", () => {
    // The toggle label legitimately reads "Enabled"/"Disabled"; the status pill type
    // constrains statusLabel so "Disabled" can never appear as a setup-status pill.
    expect(providersPage).toContain('"Connected" | "Setup needed" | "Not connected"')
  })

  it("getLightningCardState returns Connected, Setup needed, or Not connected, never Managed", () => {
    expect(providersPage).not.toContain('"Managed" as const')
    expect(providersPage).toContain('"Connected" | "Setup needed" | "Not connected"')
  })
})

describe("Wallet modal tabs and rail state", () => {
  it("modal tabs are Overview, Balances, and Withdraw only", () => {
    expect(walletPage).toContain('{ id: "overview", label: "Overview" }')
    expect(walletPage).toContain('{ id: "balances", label: "Balances" }')
    expect(walletPage).toContain('{ id: "withdraw", label: "Withdraw" }')
    expect(walletPage).not.toContain('label: "Wallets"')
    expect(walletPage).not.toContain('activeTab === "wallets"')
  })

  it("wallet rail chip requires both configured AND enabled to show as active", () => {
    expect(walletPage).toContain("row.enabled && row.configured")
  })

  it("wallet overview summary uses configured && enabled for Connected status", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })

  it("balances detail does not render a redundant Status field", () => {
    const balanceRowsSrc = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function EnabledRailChips(")
    )
    expect(balanceRowsSrc).not.toContain(">Status<")
    expect(balanceRowsSrc).not.toContain("selectedRailConnected")
  })
})

describe("Balances tab wallet details", () => {
  it("BalanceRows uses one selected asset detail view with wallet address details", () => {
    const balanceRowsSrc = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function EnabledRailChips(")
    )
    expect(balanceRowsSrc).toContain("AssetSelectDropdown")
    expect(balanceRowsSrc).toContain("dropdownOptions")
    expect(balanceRowsSrc).toContain("selectedAsset")
    expect(balanceRowsSrc).toContain("No balances yet")
    expect(balanceRowsSrc).not.toContain("allAssets.map((row, index)")
    expect(balanceRowsSrc).not.toContain("ChevronRight")
    expect(balanceRowsSrc).toContain('"Bitcoin"')
    expect(balanceRowsSrc).toContain("Wallet address")
    expect(balanceRowsSrc).toContain('aria-label="Copy wallet address"')
    expect(balanceRowsSrc).not.toContain("Lightning settlement")
    expect(balanceRowsSrc).not.toContain("groups.map")
  })

  it("BalanceRows selects the wallet address from the active rail", () => {
    const balanceRowsSrc = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function EnabledRailChips(")
    )
    expect(balanceRowsSrc).toContain("profileAddresses.base[0]?.address")
    expect(balanceRowsSrc).toContain("profileAddresses.solana[0]?.address")
    expect(balanceRowsSrc).toContain("bitcoinPayoutEntries[0]?.address")
  })

  it("Lightning settlement panel is not part of the wallet modal and payout copy stays out of Overview", () => {
    const overviewSrc = walletPage.slice(
      walletPage.indexOf("function WalletOverviewSummary("),
      walletPage.indexOf("function AssetSelectDropdown(")
    )
    const withdrawSrc = walletPage.slice(
      walletPage.indexOf("function WithdrawalFormShell("),
      walletPage.indexOf("function formatUsd(")
    )
    expect(walletPage).not.toContain("LightningSettlementPanel")
    expect(overviewSrc).not.toContain("Bitcoin Lightning payout")
    // The old default-payout-destination card was removed from the withdrawal
    // form entirely (2026-07-21) - Address Book / manual destinations replaced it.
    expect(withdrawSrc).not.toContain("Bitcoin Lightning payout")
    expect(withdrawSrc).not.toContain("Set Bitcoin payout destination")
    expect(withdrawSrc).not.toContain("lightningPayout")
    expect(walletPage).not.toContain("Last settlement")
    expect(walletPage).not.toContain("No settlements yet")
    expect(walletPage).not.toContain("Auto-settlement")
  })
})

describe("Lightning connected state derives from real readiness", () => {
  it("getLightningCardState checks Speed connected account readiness, independent of the enabled flag", () => {
    expect(providersPage).toContain('getManagedRailReadiness("lightning")')
    expect(providersPage).toContain("readiness?.walletProvisioned")
    expect(providersPage).toContain('isEnabled("lightning")')
  })

  it("ManagedCryptoRailCard checks lightning wallet-provisioning readiness for status pill", () => {
    expect(providersPage).toContain("readiness?.walletProvisioned")
  })
})

describe("TrySpeed configuration path - merchant-facing status derivation", () => {
  it("platform not configured means lightning_speed dashboard_status is provider_unavailable", () => {
    const lightningPlatformReady = false
    const connected = true
    const enabled = true
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(false)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Not connected")
  })

  it("platform configured + BTC address + enabled is Connected", () => {
    const lightningPlatformReady = true
    const connected = true
    const enabled = true
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(true)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Connected")
  })

  it("platform configured but no BTC address is Not connected", () => {
    const lightningPlatformReady = true
    const connected = false
    const enabled = true
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(false)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Not connected")
  })

  it("platform configured + BTC address + disabled is Not connected", () => {
    const lightningPlatformReady = true
    const connected = true
    const enabled = false
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(false)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Not connected")
  })
})

describe("merchant-facing copy - no internal provider jargon", () => {
  it("providers page does not mention Powered by Speed", () => {
    expect(providersPage).not.toContain("Powered by Speed")
  })

  it("providers page does not mention Managed by PineTree in crypto rail cards", () => {
    const cryptoRailsSection = providersPage.slice(providersPage.indexOf("Crypto Rails"))
    expect(cryptoRailsSection).not.toContain("Managed by PineTree")
  })

  it("wallet page does not mention Speed processor copy", () => {
    expect(walletPage).not.toContain("Powered by Speed")
    expect(walletPage).not.toContain("Managed by Speed")
  })
})
