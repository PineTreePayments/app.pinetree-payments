/**
 * Architectural boundaries for bank withdrawals.
 *
 * Bank settlement is INFRASTRUCTURE. Merchants see one Business Profile and one
 * Withdraw experience; the provider, its identifiers, and its vocabulary never
 * reach a merchant surface, a browser bundle, or the payment state machine.
 *
 * Source-text assertions on purpose: these are boundaries that must not drift,
 * and a runtime test cannot prove the absence of an import.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(__dirname, "..")
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8")

/** Everything a merchant could actually see, with the explanatory prose removed. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const MERCHANT_SURFACES = [
  "app/dashboard/settings/page.tsx",
  "app/dashboard/wallet-setup/page.tsx",
  "components/dashboard/BusinessProfileWarning.tsx",
  "components/dashboard/BusinessProfileRequirementBanner.tsx",
  "components/dashboard/ServiceTermsConsentCard.tsx",
]

describe("Merchant surfaces never import provider internals", () => {
  it("imports no Bridge provider module and no Bridge secret", () => {
    for (const file of MERCHANT_SURFACES) {
      const source = read(file)
      expect(source, file).not.toMatch(/from ["']@\/providers\/bridge/)
      expect(source, file).not.toContain("api.bridge.xyz")
      expect(source, file).not.toContain("BRIDGE_API_KEY")
      expect(source, file).not.toContain("BRIDGE_WEBHOOK_PUBLIC_KEY")
    }
  })

  it("never introduces a NEXT_PUBLIC Bridge variable anywhere", () => {
    const offenders: string[] = []
    const skip = new Set(["node_modules", ".next", ".git", "coverage", "artifacts"])
    // Every root that can ship code to a browser, plus the env templates an
    // operator copies from. A whole-repo walk would also cover build output and
    // vendored packages, which is slow and proves nothing extra.
    const roots = ["app", "components", "hooks", "lib", "providers", "engine", "database", "packages", "plugins"]

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx|js|mjs)$/.test(entry)) continue
        if (readFileSync(full, "utf8").includes("NEXT_PUBLIC_BRIDGE")) {
          offenders.push(path.relative(repoRoot, full))
        }
      }
    }

    for (const root of roots) walk(path.join(repoRoot, root))
    for (const template of [".env.example", ".env.local.example"]) {
      const full = path.join(repoRoot, template)
      if (!existsSync(full)) continue
      if (readFileSync(full, "utf8").includes("NEXT_PUBLIC_BRIDGE")) offenders.push(template)
    }

    expect(offenders).toEqual([])
  })

  it("presents PineTree vocabulary, never settlement-infrastructure terms", () => {
    for (const file of MERCHANT_SURFACES) {
      // Comments explain the boundary; only what can reach a merchant's screen
      // is under test here.
      const rendered = stripComments(read(file)).toLowerCase()
      for (const term of ["liquidation", "external_account", "drain", "endorsement", "kyb"]) {
        expect(rendered, `${file}/${term}`).not.toContain(term)
      }
    }
  })

  it("keeps the merchant Withdraw surface on PineTree-domain routes only", () => {
    const wallet = read("app/dashboard/wallet-setup/page.tsx")
    expect(wallet).toContain("/api/wallets/pinetree-wallet/bank-destinations")
    expect(wallet).toContain("/api/wallets/pinetree-wallet/bank-withdrawals")
    // The bank picker is part of Withdraw, not a provider connection surface.
    expect(wallet).toContain('label: "Bank account"')
  })

  it("does not render settlement infrastructure on the Providers page", () => {
    const providers = read("app/dashboard/providers/page.tsx")
    expect(providers.toLowerCase()).not.toContain("bridge by stripe")
    expect(providers.toLowerCase()).not.toContain("bank account")
  })
})

describe("Layering", () => {
  it("keeps provider adapters free of database writes", () => {
    for (const file of [
      "providers/bridge/adapter.ts",
      "providers/bridge/client.ts",
      "providers/bridge/normalizeMoneyMovement.ts",
      "providers/bridge/translateEvent.ts",
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/from ["']@\/database\//)
      expect(source, file).not.toMatch(/supabaseAdmin|\.from\(["']/)
    }
  })

  it("keeps API routes thin: auth, validation, Engine call", () => {
    for (const file of [
      "app/api/wallets/pinetree-wallet/bank-destinations/route.ts",
      "app/api/wallets/pinetree-wallet/bank-destinations/[id]/route.ts",
      "app/api/wallets/pinetree-wallet/bank-withdrawals/route.ts",
      "app/api/admin/business-verification/simulate-approval/route.ts",
      "app/api/onboarding/business-verification/agreement/route.ts",
    ]) {
      const source = read(file)
      // No provider client and no direct persistence from a route.
      expect(source, file).not.toMatch(/from ["']@\/providers\/bridge\/client/)
      expect(source, file).not.toMatch(/from ["']@\/database\/wallet/)
      expect(source, file).toMatch(/from ["']@\/engine\//)
    }
  })

  it("guards every new route server-side", () => {
    for (const file of [
      "app/api/wallets/pinetree-wallet/bank-destinations/route.ts",
      "app/api/wallets/pinetree-wallet/bank-destinations/[id]/route.ts",
      "app/api/wallets/pinetree-wallet/bank-withdrawals/route.ts",
    ]) {
      expect(read(file), file).toContain("requireMerchantIdFromRequest")
    }
    expect(read("app/api/admin/business-verification/simulate-approval/route.ts")).toContain(
      "requireAdminFromRequest"
    )
    // Verification routes reject merchant API keys: no scope exists for
    // advancing regulated verification on a business's behalf.
    expect(read("app/api/onboarding/business-verification/agreement/route.ts")).toContain(
      "requireOnboardingMerchantSession"
    )
  })

  it("never returns a raw bank number or provider identifier to a browser", () => {
    const route = read("app/api/wallets/pinetree-wallet/bank-destinations/route.ts")
    expect(route).not.toContain("provider_external_account_id")
    // Only the Engine's masked projection is returned.
    expect(route).toContain("result.destinations")

    const projection = read("engine/bridgeBankDestinations.ts")
    const view = projection.slice(
      projection.indexOf("export type MerchantBankDestinationView"),
      projection.indexOf("export function projectBankDestination")
    )
    expect(view).not.toContain("providerExternalAccountId")
    expect(view).toContain("accountLast4")
  })

  it("keeps settlement evidence out of the payment state machine", () => {
    const adapter = read("providers/bridge/adapter.ts")
    // The universal payment translator still refuses to emit a payment event.
    expect(adapter).toContain("override translateEvent")
    expect(adapter).toContain("return null")
    expect(adapter).toContain("readonly supportedNetworks: string[] = []")
  })
})

describe("A source-chain transaction cannot confirm a bank withdrawal", () => {
  it("gates the reconciler on destination kind before confirming", () => {
    const reconciler = read("engine/withdrawals/walletWithdrawalReconciliation.ts")
    const gate = reconciler.indexOf('withdrawal.destination_kind === "bank" && onChainStatus === "confirmed"')
    const confirm = reconciler.indexOf('const newStatus = onChainStatus === "confirmed"')
    expect(gate).toBeGreaterThan(-1)
    // The gate must run BEFORE the status is computed, or a bank withdrawal
    // would already have been confirmed by the time it is reached.
    expect(gate).toBeLessThan(confirm)
  })

  it("records the source-chain fact as evidence rather than as confirmation", () => {
    const bank = read("engine/withdrawals/bankWithdrawals.ts")
    const fn = bank.slice(bank.indexOf("export async function recordBankWithdrawalSourceChainConfirmed"))
    expect(fn).toContain("sourceChainConfirmedAt")
    // It must not touch canonical status.
    expect(fn).not.toContain('status: "confirmed"')
  })

  it("confirms only from provider payout evidence", () => {
    const bank = read("engine/withdrawals/bankWithdrawals.ts")
    expect(bank).toContain("mapDrainStateToWithdrawal")
    // The only status write in the settlement path comes from that mapping.
    expect(bank).toContain("status: outcome.status")
    expect(bank).not.toMatch(/status:\s*"confirmed"/)
  })

  it("reuses the existing withdrawal ledger rather than adding a second one", () => {
    const bank = read("engine/withdrawals/bankWithdrawals.ts")
    expect(bank).toContain('from "@/database/walletWithdrawalRequests"')
    expect(bank).toContain("createWalletWithdrawalReview")
    const migration = read(
      "database/migrations/20260807120000_create_bridge_bank_withdrawal_foundation.sql"
    )
    expect(migration).toContain("alter table public.wallet_withdrawal_requests")
    // No second withdrawal table, no second merchant identity table.
    expect(migration).not.toMatch(/create table if not exists public\.\w*withdrawal\w*_v2/)
    expect(migration).not.toMatch(/create table if not exists public\.merchant_profiles/)
  })

  it("owns bank reconciliation in the existing withdrawal worker", () => {
    const reconciler = read("engine/withdrawals/walletWithdrawalReconciliation.ts")
    expect(reconciler).toContain("reconcileBankWithdrawalsEngine")
    // No new scheduler: the architecture allows exactly one production
    // recurring job, and this shares the withdrawal worker that already owns
    // the ledger.
    const architecture = read("docs/architecture.md")
    expect(architecture).toContain("Withdrawal reconciliation")
  })
})

describe("Existing rails are untouched", () => {
  it("leaves crypto withdrawals defaulting to the historical behavior", () => {
    const persistence = read("database/walletWithdrawalRequests.ts")
    expect(persistence).toContain('row.destination_kind === "bank" ? "bank" : "crypto"')
    const migration = read(
      "database/migrations/20260807120000_create_bridge_bank_withdrawal_foundation.sql"
    )
    expect(migration).toContain("destination_kind             text        not null default 'crypto'")
  })

  it("does not route Bitcoin, Speed, or card rails through settlement", () => {
    const bank = read("engine/withdrawals/bankWithdrawals.ts")
    for (const term of ["bitcoin", "speed", "lightning", "shift4", "stripe", "fluidpay"]) {
      expect(bank.toLowerCase(), term).not.toContain(term)
    }
  })

  it("adds no conversion provider for native assets", () => {
    const routes = read("engine/bridgeLiquidationRoutes.ts")
    expect(routes).toContain('{ rail: "base", asset: "USDC" }')
    expect(routes).toContain('{ rail: "solana", asset: "USDC" }')
    for (const term of ["lifi", "li.fi", "swap", "convert"]) {
      expect(routes.toLowerCase(), term).not.toContain(term)
    }
  })

  it("hardcodes no bank-withdrawal fee and sets no developer fee", () => {
    for (const file of [
      "engine/withdrawals/bankWithdrawals.ts",
      "engine/bridgeLiquidationRoutes.ts",
      "providers/bridge/client.ts",
    ]) {
      const source = read(file)
      expect(source, file).not.toContain("custom_developer_fee_percent")
      expect(source, file).not.toContain("0.25")
    }
  })
})
