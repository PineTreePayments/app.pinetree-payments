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
    expect(page).toContain("Manage from PineTree Wallet")
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

  it("constrains rail to solana and base only", () => {
    expect(migration).toContain("'solana'")
    expect(migration).toContain("'base'")
  })

  it("enforces uniqueness of merchant_id + rail combination", () => {
    expect(migration).toContain("UNIQUE (merchant_id, rail)")
  })
})
