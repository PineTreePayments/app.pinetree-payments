import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

const walletPage = read("app/dashboard/wallet-setup/page.tsx")
const providersPage = read("app/dashboard/providers/page.tsx")

// ---------------------------------------------------------------------------
// Helpers – extract source regions
// ---------------------------------------------------------------------------

function fetchProviderRailStateSrc() {
  return walletPage.slice(
    walletPage.indexOf("const fetchProviderRailState = useCallback"),
    walletPage.indexOf("// --- Load profiles and provider rail enablement from DB on mount ---")
  )
}

function withdrawalWalletRowsSrc() {
  return walletPage.slice(
    walletPage.indexOf("const withdrawalWalletRows = useMemo(() => ["),
    walletPage.indexOf("const withdrawableAssetOptions = useMemo")
  )
}

function withdrawableAssetOptionsSrc() {
  return walletPage.slice(
    walletPage.indexOf("const withdrawableAssetOptions = useMemo"),
    walletPage.indexOf("const selectedWithdrawalBalance = useMemo")
  )
}

function bitcoinReadinessSrc() {
  return walletPage.slice(
    walletPage.indexOf("const btcPayoutReady"),
    walletPage.indexOf("const dynamicEmbeddedSignersReady")
  )
}

function providerRailStateSrc() {
  return walletPage.slice(
    walletPage.indexOf("setEnabledRails({"),
    walletPage.indexOf("} catch {\n      setEnabledRails(defaultEnabledRails)")
  )
}

// ---------------------------------------------------------------------------
// 1. Asset dropdown source of truth
// ---------------------------------------------------------------------------

describe("Withdraw asset dropdown source of truth", () => {
  it("withdrawalWalletRows requires address AND provider enabled for Base", () => {
    const src = withdrawalWalletRowsSrc()
    expect(src).toContain("configured: baseReady && enabledRails.base")
  })

  it("withdrawalWalletRows requires address AND provider enabled for Solana", () => {
    const src = withdrawalWalletRowsSrc()
    expect(src).toContain("configured: solanaReady && enabledRails.solana")
  })

  it("withdrawalWalletRows requires address AND provider enabled for Bitcoin", () => {
    const src = withdrawalWalletRowsSrc()
    expect(src).toContain("configured: bitcoinReady && enabledRails.bitcoin")
  })

  it("withdrawableAssetOptions filters by configured only — balance status does not gate assets", () => {
    const src = withdrawableAssetOptionsSrc()
    expect(src).toContain(".filter((row) => row.configured)")
    expect(src).not.toContain("balance.status")
    expect(src).not.toContain(".filter((row) => row.configured && row.balance")
    expect(src).not.toContain("synced")
    expect(src).not.toContain("pending_sync")
    expect(src).not.toContain("config_missing")
  })

  it("withdrawalAssetsByRail defines SOL + USDC for Solana and ETH + USDC for Base", () => {
    expect(walletPage).toContain('base: ["ETH", "USDC"]')
    expect(walletPage).toContain('solana: ["SOL", "USDC"]')
    expect(walletPage).toContain('bitcoin: ["BTC"]')
  })

  it("dependency array of withdrawalWalletRows includes enabledRails properties", () => {
    const src = withdrawalWalletRowsSrc()
    expect(src).toContain("enabledRails.base")
    expect(src).toContain("enabledRails.solana")
    expect(src).toContain("enabledRails.bitcoin")
  })
})

// ---------------------------------------------------------------------------
// 2. Bitcoin visibility — only when payout is actually ready
// ---------------------------------------------------------------------------

describe("Bitcoin withdrawal availability", () => {
  it("bitcoinReady is derived from normalized Lightning wallet provisioning, not just address presence", () => {
    const src = bitcoinReadinessSrc()
    expect(src).toContain("railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(walletPage).not.toContain("const bitcoinReady = bitcoinPayoutEntries.length > 0")
  })

  it("btcPayoutReady requires both btc_address and btc_payout_enabled", () => {
    const src = bitcoinReadinessSrc()
    expect(src).toContain("btc_address")
    expect(src).toContain("btc_payout_enabled")
    expect(src).toContain("btcPayoutReady")
  })

  it("Bitcoin remains in the withdrawal dropdown when the Speed account is ready", () => {
    const rowSrc = withdrawalWalletRowsSrc()
    expect(rowSrc).toContain("configured: bitcoinReady && enabledRails.bitcoin")
  })

  it("auto-provisioned btc_address alone does not make Bitcoin withdrawable", () => {
    // Previously bitcoinReady = bitcoinPayoutEntries.length > 0 (address-only check).
    // After fix: requires btc_payout_enabled too.
    expect(walletPage).not.toContain("const bitcoinReady = bitcoinPayoutEntries.length > 0")
  })
})

// ---------------------------------------------------------------------------
// 3. Provider enabled flag — toggle only, not connection status
// ---------------------------------------------------------------------------

describe("enabledRails reflects toggle state, not connection status", () => {
  it("providerEnabled checks only row.enabled, not status connected/active", () => {
    const src = fetchProviderRailStateSrc()
    expect(src).toContain("return Boolean(row?.enabled === true)")
    expect(src).not.toContain('status === "connected"')
    expect(src).not.toContain('status === "active"')
  })

  it("enabledRails.bitcoin maps to lightning_speed provider enabled flag", () => {
    const src = providerRailStateSrc()
    expect(src).toContain('providerEnabled("lightning_speed")')
  })

  it("enabledRails.base and enabledRails.solana map to their provider enabled flags", () => {
    const src = providerRailStateSrc()
    expect(src).toContain('providerEnabled("base")')
    expect(src).toContain('providerEnabled("solana")')
  })
})

// ---------------------------------------------------------------------------
// 4. Providers page and wallet page agree on readiness
// ---------------------------------------------------------------------------

describe("Providers page and Wallet page readiness agreement", () => {
  it("ManagedCryptoRailCard uses normalized walletProvisioned for address-based connected check", () => {
    expect(providersPage).toContain("const connected = Boolean(readiness?.walletProvisioned ?? isCanonicalRailConfigured(provider))")
  })

  it("isCanonicalRailConfigured checks pineTreeWalletProfile address flags", () => {
    expect(providersPage).toContain("pineTreeWalletProfile?.solanaAddressPresent")
    expect(providersPage).toContain("pineTreeWalletProfile?.baseAddressPresent")
    expect(providersPage).toContain("pineTreeWalletProfile?.bitcoinAddressPresent")
  })

  it("ManagedCryptoRailCard status is Connected whenever the wallet/account is provisioned, regardless of the enabled toggle", () => {
    expect(providersPage).toContain('const statusLabel = connected ? "Connected" : readiness ? "Setup needed" : "Not connected"')
  })

  it("toggling the enabled preference off does not change the connected/setup status pill", () => {
    // The pill is driven entirely by `connected` (walletProvisioned); merchantPreferenceEnabled
    // only drives the toggle's checked state and whether it can be turned back on.
    expect(providersPage).toContain("const toggleOn = merchantPreferenceEnabled")
    expect(providersPage).toContain("checked={toggleOn}")
    expect(providersPage).toContain("function canEnableManagedRail")
    expect(providersPage).toContain("const toggleDisabled = !merchantPreferenceEnabled && !canEnable")
    expect(providersPage).not.toContain('statusLabel = enabled ? "Connected"')
    expect(providersPage).not.toContain("statusLabel = merchantPreferenceEnabled")
  })

  it("walletRailRows connected display requires both configured (address) and enabled (toggle)", () => {
    expect(walletPage).toContain("row.configured && row.enabled")
    expect(walletPage).toContain('"Connected" : "Not connected"')
  })
})

// ---------------------------------------------------------------------------
// 5. walletStatus does not gate the asset list
// ---------------------------------------------------------------------------

describe("walletStatus Not connected does not hide asset list", () => {
  it("withdrawalWalletRows does not reference walletStatus", () => {
    const src = withdrawalWalletRowsSrc()
    expect(src).not.toContain("walletStatus")
    expect(src).not.toContain('"Not connected"')
  })

  it("withdrawableAssetOptions does not reference walletStatus", () => {
    const src = withdrawableAssetOptionsSrc()
    expect(src).not.toContain("walletStatus")
  })

  it("asset options depend only on address presence and provider enabled, not overall wallet status", () => {
    // walletStatus is derived from dynamicProfileReady + signer states.
    // configured for withdrawal is baseReady && enabledRails.base — no walletStatus involvement.
    expect(walletPage).toContain("configured: baseReady && enabledRails.base")
    expect(walletPage).toContain("configured: solanaReady && enabledRails.solana")
    const src = withdrawalWalletRowsSrc()
    expect(src).not.toContain("baseSignerReady")
    expect(src).not.toContain("solanaSignerReady")
    expect(src).not.toContain("dynamicProfileReady")
  })
})

// ---------------------------------------------------------------------------
// 6. Balance status does not hide asset options
// ---------------------------------------------------------------------------

describe("Balance status does not gate asset options in dropdown", () => {
  it("withdrawableAssetOptions includes balance but does not filter on it", () => {
    const src = withdrawableAssetOptionsSrc()
    // balance is attached to each option for display but never used as a filter
    expect(src).toContain("balance: findWithdrawalBalance(walletSync, row.rail, item)")
    expect(src).not.toContain("balance?.status")
    expect(src).not.toContain('balance?.status === "synced"')
    expect(src).not.toContain('balance?.status === "pending_sync"')
  })

  it("formatBalanceLabel shows pending copy when balance is not synced", () => {
    expect(walletPage).toContain('"Balance indexing pending"')
    expect(walletPage).toContain('balance?.status === "unavailable"')
  })

  it("pending or config_missing balance still results in asset appearing in dropdown", () => {
    // The configured gate only cares about address + provider enabled.
    // Balance status is cosmetic (shown as label) but never gates inclusion.
    const src = withdrawableAssetOptionsSrc()
    expect(src).not.toContain("config_missing")
    expect(src).not.toContain("pending_sync")
    const filterSrc = src.match(/\.filter\([^)]+\)/g) ?? []
    filterSrc.forEach((f) => {
      expect(f).not.toContain("balance")
      expect(f).not.toContain("status")
    })
  })
})
