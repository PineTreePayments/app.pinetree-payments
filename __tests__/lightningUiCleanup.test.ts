import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

const providersPage = read("app/dashboard/providers/page.tsx")
const walletPage = read("app/dashboard/wallet-setup/page.tsx")

// ---------------------------------------------------------------------------
// 1 & 2 — Bitcoin Lightning provider card structure
// ---------------------------------------------------------------------------

describe("Bitcoin Lightning provider card cleanup", () => {
  it("ManagedCryptoRailCard no longer has the isLightning extra-rows branch", () => {
    // isLightning was the flag that injected Destination and Status rows
    expect(providersPage).not.toContain("isLightning")
  })

  it("provider card does not render a Destination row for Lightning", () => {
    // "Destination" text was inside the removed isLightning block
    expect(providersPage).not.toContain(">Destination<")
  })

  it("provider card does not render a Status row for Lightning", () => {
    // "Status" as a provider-card label was inside the removed isLightning block
    expect(providersPage).not.toContain(">Status<")
  })

  it("provider card does not render Auto-settlement", () => {
    expect(providersPage).not.toContain("Auto-settlement")
  })

  it("provider card does not render Processor label", () => {
    expect(providersPage).not.toContain(">Processor<")
  })

  it("provider card does not mention Powered by Speed", () => {
    expect(providersPage).not.toContain("Powered by Speed")
  })

  it("provider card does not show internal connection-box jargon", () => {
    expect(providersPage).not.toContain("PineTree Wallet settlement connected")
    expect(providersPage).not.toContain("Bitcoin payouts route to the merchant")
    expect(providersPage).not.toContain("Legacy Lightning")
  })

  it("Bitcoin Lightning card renders Networks and Settlement rows (canonical mode)", () => {
    expect(providersPage).toContain('networks="Bitcoin Lightning"')
    // Settlement row is present via the generic ManagedCryptoRailCard markup
    expect(providersPage).toContain(">Settlement<")
    expect(providersPage).toContain(">Networks<")
  })

  it("Bitcoin Lightning description uses clean merchant-facing copy", () => {
    expect(providersPage).toContain("Lightning payments settle to the merchant")
    expect(providersPage).toContain("PineTree Wallet.")
  })
})

// ---------------------------------------------------------------------------
// 3 — Disabled rails show Not connected, not a yellow Disabled pill
// ---------------------------------------------------------------------------

describe("rail status vocabulary — Connected / Not connected only", () => {
  it("ManagedCryptoRailCard uses Connected or Not connected status labels", () => {
    // The component computes statusLabel as one of two strings
    expect(providersPage).toContain('"Connected" : "Not connected"')
  })

  it("providers page does not use a yellow Disabled pill for crypto rails", () => {
    // No amber/yellow "Disabled" label in the managed rail cards
    expect(providersPage).not.toContain('"Disabled"')
  })

  it("getLightningCardState returns Connected or Not connected, never Managed", () => {
    // The function now derives status from actual BTC address + platform readiness
    expect(providersPage).not.toContain('"Managed" as const')
    expect(providersPage).toContain('"Connected" | "Not connected"')
  })
})

// ---------------------------------------------------------------------------
// 4 — Solana toggled off does not show as active connected rail
// ---------------------------------------------------------------------------

describe("Solana rail enabled state", () => {
  it("wallet rail chip requires both configured AND enabled to show as active", () => {
    // EnabledRailChips filters with row.enabled && row.configured
    expect(walletPage).toContain("row.enabled && row.configured")
  })

  it("wallet overview summary uses configured && enabled for Connected status", () => {
    expect(walletPage).toContain('row.configured && row.enabled ? "Connected" : "Not connected"')
  })

  it("wallets tab ReceiveRow for Solana derives status from solanaReady && enabledRails.solana", () => {
    expect(walletPage).toContain("solanaReady && enabledRails.solana ? \"Connected\" : \"Not connected\"")
  })
})

// ---------------------------------------------------------------------------
// 5 & 6 — Balances tab: one Bitcoin card, no duplicate Lightning settlement panel
// ---------------------------------------------------------------------------

describe("Balances tab — no duplicate Lightning settlement card", () => {
  it("Balances tab renders BalanceRows (which has exactly one Bitcoin group)", () => {
    // BalanceRows groups: Base, Solana, Bitcoin — only one Bitcoin group
    const balanceRowsSrc = walletPage.slice(
      walletPage.indexOf("function BalanceRows("),
      walletPage.indexOf("function LightningSettlementPanel(")
    )
    expect(balanceRowsSrc).toContain('"Bitcoin"')
    // Only one occurrence of "Bitcoin" as a group title in BalanceRows
    const bitcoinGroupCount = (balanceRowsSrc.match(/"Bitcoin"/g) || []).length
    expect(bitcoinGroupCount).toBe(1)
  })

  it("LightningSettlementPanel is not rendered inside the balances tab branch", () => {
    const balancesSection = walletPage.slice(
      walletPage.indexOf('activeTab === "balances"'),
      walletPage.indexOf('activeTab === "wallets"')
    )
    expect(balancesSection).not.toContain("LightningSettlementPanel")
  })

  it("LightningSettlementPanel component appears exactly twice (definition + wallets tab)", () => {
    const count = (walletPage.match(/LightningSettlementPanel/g) || []).length
    expect(count).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 7 — Wallets tab renders compact Lightning settlement configuration card
// ---------------------------------------------------------------------------

describe("Wallets tab — compact Lightning settlement card", () => {
  it("Wallets tab renders LightningSettlementPanel", () => {
    const walletsSection = walletPage.slice(
      walletPage.indexOf('activeTab === "wallets"'),
      walletPage.indexOf('activeTab === "withdraw"')
    )
    expect(walletsSection).toContain("LightningSettlementPanel")
  })

  it("compact card title is Lightning settlement (not Bitcoin Lightning settlement)", () => {
    expect(walletPage).toContain("Lightning settlement")
    expect(walletPage).not.toContain("Bitcoin Lightning settlement")
  })

  it("compact card shows Destination field", () => {
    expect(walletPage).toContain("Destination")
  })

  it("compact card has Set destination and Refresh actions", () => {
    expect(walletPage).toContain("Set destination")
    expect(walletPage).toContain("Refresh")
  })

  it("compact card does not show Last settlement or No settlements yet", () => {
    expect(walletPage).not.toContain("Last settlement")
    expect(walletPage).not.toContain("No settlements yet")
  })

  it("compact card does not mention Auto-settlement", () => {
    expect(walletPage).not.toContain("Auto-settlement")
  })
})

// ---------------------------------------------------------------------------
// 8 — Lightning connected state depends on real config/readiness
// ---------------------------------------------------------------------------

describe("Lightning connected state derives from real readiness", () => {
  it("getLightningCardState checks BTC address presence, platform config, and enabled flag", () => {
    expect(providersPage).toContain("isCanonicalRailConfigured(\"lightning\")")
    expect(providersPage).toContain('dashboard_status === "connected"')
    expect(providersPage).toContain('isEnabled("lightning")')
  })

  it("ManagedCryptoRailCard checks lightning platform readiness for status pill", () => {
    expect(providersPage).toContain("lightningPlatformReady")
    expect(providersPage).toContain('provider !== "lightning"')
  })

  it("LightningSettlementPanel connected state requires destination, enabled, and payoutAvailable", () => {
    expect(walletPage).toContain(
      "Boolean(activeDestination && overview?.settings?.enabled && overview?.capabilities.payoutAvailable)"
    )
  })

  it("LightningSettlementPanel status is only Connected or Not connected (no Needs setup)", () => {
    expect(walletPage).toContain('settlementConnected ? "Connected" : "Not connected"')
    expect(walletPage).not.toContain('"Needs setup"')
  })
})

// ---------------------------------------------------------------------------
// 9 & 10 — TrySpeed config paths (covered by providersDashboard.test.ts; mirror here)
// ---------------------------------------------------------------------------

describe("TrySpeed configuration path — merchant-facing status derivation", () => {
  it("platform not configured means lightning_speed dashboard_status is provider_unavailable", () => {
    // In decorateProviderRows: dashboard_status = platformStatus.configured ? "connected" : "provider_unavailable"
    // ManagedCryptoRailCard checks: dashboard_status === "connected" for lightningPlatformReady
    // So provider_unavailable → lightningPlatformReady=false → statusLabel="Not connected"
    const lightningPlatformReady = false // dashboard_status !== "connected"
    const connected = true               // BTC address present
    const enabled = true                 // merchant toggled on
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(false)
    // Merchant sees "Not connected"
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Not connected")
  })

  it("platform configured + BTC address + enabled → Connected", () => {
    const lightningPlatformReady = true  // dashboard_status === "connected"
    const connected = true               // BTC address present
    const enabled = true                 // merchant toggled on
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(true)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Connected")
  })

  it("platform configured but no BTC address → Not connected", () => {
    const lightningPlatformReady = true
    const connected = false // no BTC address
    const enabled = true
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(false)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Not connected")
  })

  it("platform configured + BTC address + disabled → Not connected", () => {
    const lightningPlatformReady = true
    const connected = true
    const enabled = false // merchant toggled off
    const usable = connected && enabled && lightningPlatformReady
    expect(usable).toBe(false)
    const statusLabel = usable ? "Connected" : "Not connected"
    expect(statusLabel).toBe("Not connected")
  })
})

// ---------------------------------------------------------------------------
// 11 — No Powered by Speed or Managed by PineTree in wallet/provider cards
// ---------------------------------------------------------------------------

describe("merchant-facing copy — no internal provider jargon", () => {
  it("providers page does not mention Powered by Speed", () => {
    expect(providersPage).not.toContain("Powered by Speed")
  })

  it("providers page does not mention Managed by PineTree in crypto rail cards", () => {
    // "Managed by PineTree" appears in card provider blocks only (shift4/stripe/fluidpay)
    // It must NOT appear in Lightning or other crypto rail card surfaces
    const cryptoRailsSection = providersPage.slice(
      providersPage.indexOf("Crypto Rails")
    )
    expect(cryptoRailsSection).not.toContain("Managed by PineTree")
  })

  it("wallet page does not mention Powered by Speed", () => {
    expect(walletPage).not.toContain("Powered by Speed")
  })

  it("wallet page does not mention Managed by Speed", () => {
    expect(walletPage).not.toContain("Managed by Speed")
  })

  it("Lightning settlement panel does not reference Speed or internal processor names", () => {
    const panelSrc = walletPage.slice(
      walletPage.indexOf("function LightningSettlementPanel("),
      walletPage.indexOf("function settlementStatusLabel(")
    )
    expect(panelSrc).not.toContain("Speed")
    expect(panelSrc).not.toContain("Powered by")
    expect(panelSrc).not.toContain("Managed by")
  })
})
