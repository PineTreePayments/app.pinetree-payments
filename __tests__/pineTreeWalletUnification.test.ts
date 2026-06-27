import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

// ---------------------------------------------------------------------------
// Navigation consolidation
// ---------------------------------------------------------------------------

describe("Dashboard navigation consolidation", () => {
  const layout = read("app/dashboard/layout.tsx")

  it("has a single Wallet nav entry pointing to /dashboard/wallet-setup", () => {
    expect(layout).toContain('{ name: "Wallet", href: "/dashboard/wallet-setup" }')
  })

  it("no longer has a Wallets nav entry pointing to /dashboard/wallets", () => {
    expect(layout).not.toContain('href: "/dashboard/wallets"')
  })

  it("no longer has a Wallet Setup nav entry (renamed to Wallet)", () => {
    expect(layout).not.toContain('name: "Wallet Setup"')
  })
})

// ---------------------------------------------------------------------------
// /dashboard/wallets redirects to /dashboard/wallet-setup
// ---------------------------------------------------------------------------

describe("Wallets page redirect", () => {
  const walletsPage = read("app/dashboard/wallets/page.tsx")

  it("imports redirect from next/navigation", () => {
    expect(walletsPage).toContain('from "next/navigation"')
    expect(walletsPage).toContain("redirect")
  })

  it("redirects to /dashboard/wallet-setup", () => {
    expect(walletsPage).toContain('redirect("/dashboard/wallet-setup")')
  })

  it("is a server component (no use client directive)", () => {
    expect(walletsPage).not.toContain('"use client"')
  })
})

// ---------------------------------------------------------------------------
// Rail sync is triggered from wallet-setup page after profile sync
// ---------------------------------------------------------------------------

describe("Rail sync trigger in wallet-setup page", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")

  it("fires rail sync fetch after successful profile POST", () => {
    expect(page).toContain("/api/wallets/pinetree-wallet/rail-sync")
    expect(page).toContain('method: "POST"')
  })

  it("fires rail sync as fire-and-forget (void fetch)", () => {
    expect(page).toContain("void fetch(\"/api/wallets/pinetree-wallet/rail-sync\"")
  })
})

// ---------------------------------------------------------------------------
// Payment readiness canonical wallet mode fallback
// ---------------------------------------------------------------------------

describe("paymentReadiness canonical wallet mode", () => {
  const engine = read("engine/paymentReadiness.ts")

  it("checks PINE_TREE_WALLET_CANONICAL env var", () => {
    expect(engine).toContain("PINE_TREE_WALLET_CANONICAL")
  })

  it("falls back to pineTreeWalletProfile.solana_address when canonical mode is active", () => {
    expect(engine).toContain("pineTreeWalletProfile.solana_address")
    expect(engine).toContain("pineTreeWalletProfile.base_address")
  })

  it("only applies fallback when merchant_wallets does not already have the address", () => {
    expect(engine).toContain("!walletByNetwork.has(\"solana\")")
    expect(engine).toContain("!walletByNetwork.has(\"base\")")
  })

  it("requires Speed config, BTC address, and merchant enablement for Lightning readiness", () => {
    expect(engine).toContain("const merchantLightningEnabled = speedProvider?.enabled !== false")
    expect(engine).toContain("const speedReady = Boolean(speedConfig.configured && merchantLightningEnabled)")
    expect(engine).toContain("const btcPayoutReady = Boolean(btcAddress && pineTreeWalletProfile?.btc_payout_enabled)")
    expect(engine).toContain("connected: btcPayoutReady")
  })
})

// ---------------------------------------------------------------------------
// Checkout/POS rail filtering
// ---------------------------------------------------------------------------

describe("payment intent rail filtering", () => {
  const engine = read("engine/paymentIntents.ts")

  it("filters wallet rails through enabled provider rows", () => {
    expect(engine).toContain(".filter(merchantProviderCanProcessPayments)")
    expect(engine).toContain("enabledProviders.has(providerKey)")
    expect(engine).toContain("if (allProviderKeys.has(providerKey)) return false")
  })

  it("requires an enabled Speed or Lightning provider before showing Bitcoin Lightning", () => {
    expect(engine).toContain("enabledProviders.has(SPEED_PROVIDER_NAME)")
    expect(engine).toContain('enabledProviders.has("lightning")')
    expect(engine).toContain('enabledProviders.has("lightning_nwc")')
    expect(engine).toContain("getPineTreeWalletProfile")
    expect(engine).toContain("const btcPayoutReady = Boolean(pineTreeWalletProfile?.btc_address && pineTreeWalletProfile.btc_payout_enabled)")
    expect(engine).toContain("return Boolean(speedConfig.configured && btcPayoutReady)")
  })
})

// ---------------------------------------------------------------------------
// Providers page canonical wallet mode
// ---------------------------------------------------------------------------

describe("Providers page canonical wallet mode", () => {
  const page = read("app/dashboard/providers/page.tsx")

  it("defines canonicalWalletMode using NEXT_PUBLIC_PINE_TREE_WALLET_CANONICAL", () => {
    expect(page).toContain("canonicalWalletMode")
    expect(page).toContain("NEXT_PUBLIC_PINE_TREE_WALLET_CANONICAL")
  })

  it("shows managed cards for Solana and Base when canonicalWalletMode is true", () => {
    expect(page).toContain("{canonicalWalletMode ? (")
    expect(page).toContain('name="Solana Pay"')
    expect(page).toContain('name="Base Pay"')
    expect(page).toContain('name="Bitcoin Lightning"')
    expect(page).toContain('description="Solana payments settle to the merchant\'s PineTree Wallet."')
    expect(page).toContain('description="Base payments settle to the merchant\'s PineTree Wallet."')
    expect(page).toContain('description="Lightning payments settle to the merchant\'s PineTree Wallet."')
    expect(page).toContain("Manage from PineTree Wallet")
  })

  it("uses PineTree Wallet settlement for managed rails", () => {
    expect(page).toContain("function ManagedCryptoRailCard")
    expect(page).toContain(">Settlement</span>")
    expect(page).toContain(">PineTree Wallet</span>")
    // Destination row was removed from the card; settlement label is sufficient
  })

  it("shows managed crypto rails as Connected or Not connected with Enabled toggles", () => {
    expect(page).toContain('provider: "solana" | "base" | "lightning"')
    expect(page).toContain('"Connected" : "Not connected"')
    expect(page).not.toContain('"Not configured"')
    expect(page).toContain(">Enabled</span>")
    expect(page).toContain("onChange={(v) => toggleProvider(provider, v)}")
    expect(page).toContain("disabled={!connected}")
  })

  it("calculates canonical rail connection from PineTree Wallet profile address presence", () => {
    const engine = read("engine/providersDashboard.ts")
    expect(engine).toContain("getPineTreeWalletProfile")
    expect(engine).toContain("baseAddressPresent: Boolean(pineTreeWalletProfile.base_address)")
    expect(engine).toContain("solanaAddressPresent: Boolean(pineTreeWalletProfile.solana_address)")
    expect(engine).toContain("pineTreeWalletProfile.btc_address || pineTreeWalletProfile.bitcoin_onchain_address")
    expect(page).toContain("function isCanonicalRailConfigured")
    expect(page).toContain("pineTreeWalletProfile?.solanaAddressPresent")
    expect(page).toContain("pineTreeWalletProfile?.baseAddressPresent")
    expect(page).toContain("pineTreeWalletProfile?.bitcoinAddressPresent")
  })

  it("keeps Connected/Not connected status independent from the Enabled toggle", () => {
    expect(page).toContain("const connected = isCanonicalRailConfigured(provider)")
    expect(page).toContain("const enabled = isEnabled(provider)")
    // Status pill reflects address presence, merchant enabled choice, and platform readiness
    expect(page).toContain("const usable = connected && enabled && lightningPlatformReady")
    expect(page).toContain("const statusLabel = usable")
    expect(page).toContain('"Connected" : "Not connected"')
    expect(page).toContain("checked={enabled}")
  })

  it("does not let the legacy Bitcoin Lightning setup card render in canonical wallet mode", () => {
    expect(page).toContain("{!canonicalWalletMode && (() => {")
    expect(page).not.toContain("Setup needed: connect Speed Lightning or Advanced NWC.")
    expect(page).not.toContain("Connect Speed")
    expect(page).not.toContain("Advanced NWC")
    expect(page).not.toContain("Speed Connect")
    expect(page).not.toContain("Open Speed dashboard")
    expect(page).not.toContain("Manual Lightning setup")
  })

  it("falls back to ProviderCard connect flow when not in canonical mode", () => {
    // The else branch still renders the original ProviderCard
    expect(page).toContain("<ProviderCard")
    expect(page).toContain('provider="solana"')
    expect(page).toContain('provider="base"')
  })
})

// ---------------------------------------------------------------------------
// DB migration for rail syncs table
// ---------------------------------------------------------------------------

describe("pinetree_wallet_rail_syncs migration", () => {
  const migration = read("database/migrations/20260623_create_pinetree_wallet_rail_syncs.sql")

  it("creates the pinetree_wallet_rail_syncs table", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS pinetree_wallet_rail_syncs")
  })

  it("constrains rail to the canonical wallet rails", () => {
    expect(migration).toContain("'solana'")
    expect(migration).toContain("'base'")
    const bitcoinMigration = read("database/migrations/20260624_expand_pinetree_wallet_rail_syncs_bitcoin.sql")
    expect(bitcoinMigration).toContain("'bitcoin_lightning'")
  })

  it("enforces uniqueness of merchant_id + rail combination", () => {
    expect(migration).toContain("UNIQUE (merchant_id, rail)")
  })
})
