import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const wallet = readFileSync("app/dashboard/wallet-setup/page.tsx", "utf8")
const syncEngine = readFileSync("engine/pineTreeWalletSync.ts", "utf8")
const managementPanel = readFileSync("components/dashboard/MerchantWalletManagementPanel.tsx", "utf8")
const walletOperations = readFileSync("engine/wallet/walletOperations.ts", "utf8")

describe("Bitcoin wallet visibility regressions", () => {
  it("includes BTC in Balances from ready connected-account state without requiring a payout address", () => {
    expect(wallet).toContain("if (bitcoinReady) rows.push(...(sync?.balances.bitcoin ?? []))")
    expect(wallet).toContain("bitcoinReady={bitcoinReady}")
    expect(wallet).not.toContain("if (bitcoinPayoutEntries.length > 0) rows.push(...(sync?.balances.bitcoin ?? []))")
  })

  it("includes BTC in Withdraw even at zero or before a snapshot exists", () => {
    expect(wallet).toContain('{ rail: "bitcoin" as const, configured: bitcoinReady && enabledRails.bitcoin }')
    expect(wallet).toContain('bitcoin: ["BTC"]')
    expect(wallet).toContain("bitcoinBalanceUnavailable")
    expect(wallet).toContain("selectedBalanceZero")
  })

  it("distinguishes live zero, cached, stale, and unavailable balance states", () => {
    expect(syncEngine).toContain('speedBitcoinSyncState === "live" && row')
    expect(syncEngine).toContain('? "stale" : "cached"')
    expect(syncEngine).toContain(': "unavailable"')
    expect(wallet).toContain("Balance temporarily unavailable")
    expect(wallet).toContain('balance.status === "stale" ? " (stale)"')
    expect(wallet).toContain('balance.status === "cached" ? " (cached)"')
  })

  it("uses one canonical BTC/Bitcoin Lightning identity and removes duplicate rows", () => {
    expect(walletOperations).toContain('return { asset: "BTC", network: "bitcoin_lightning" }')
    expect(walletOperations).toContain("Array.from(new Map(")
    expect(wallet).toContain("Array.from(new Map(visible.map((row) => [row.key, row])).values())")
  })

  it("shows a fixed BTC selector, disables no-balance submission, and never exposes an account id", () => {
    expect(managementPanel).toContain('<option value="BTC">BTC - Bitcoin Lightning</option>')
    expect(managementPanel).toContain("!hasSpendableBalance")
    expect(managementPanel).not.toContain("speedAccountId")
    expect(managementPanel).not.toContain("speed_account_id")
  })

  it("routes the main BTC withdrawal flow through generic Instant Send with exact sats", () => {
    expect(wallet).toContain('fetch("/api/wallets/withdrawals"')
    expect(wallet).toContain('"Idempotency-Key": instantSendIdempotencyKey')
    expect(wallet).toContain('asset: "SATS"')
    expect(wallet).toContain("btcDecimalToSats")
    expect(wallet).not.toContain("Math.round(Number(withdrawalReview.review.amountDecimal) * 100_000_000)")
  })
})
