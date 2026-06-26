import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("PineTree-native Lightning settlement", () => {
  const migration = read("database/migrations/20260626_create_lightning_settlement_native_tables.sql")
  const walletPage = read("app/dashboard/wallet-setup/page.tsx")
  const providersPage = read("app/dashboard/providers/page.tsx")
  const route = read("app/api/internal/lightning-settlement-payouts/process/route.ts")
  const engine = read("engine/lightningSettlement.ts")
  const eventProcessor = read("engine/eventProcessor.ts")
  const adapter = read("providers/speed/speedLightningSettlement.ts")
  const speedClient = read("providers/lightning/speedClient.ts")
  const payoutJobsDb = read("database/lightningSettlementPayoutJobs.ts")

  it("creates PineTree-native settlement migrations", () => {
    expect(migration).toContain("create table if not exists merchant_payout_destinations")
    expect(migration).toContain("create table if not exists lightning_settlement_settings")
    expect(migration).toContain("create table if not exists lightning_settlement_payout_jobs")
    expect(migration).toContain("destination_type in ('pinetree_btc_wallet', 'external_btc_wallet', 'speed_connected_account')")
    expect(migration).toContain("provider_sync_status in ('not_synced', 'synced', 'pending', 'failed', 'not_available')")
    expect(migration).toContain("status in ('queued', 'processing', 'submitted', 'completed', 'failed', 'canceled')")
  })

  it("keeps Lightning separate from normal wallet withdrawals", () => {
    expect(walletPage).toContain('type WithdrawalAsset = "ETH" | "USDC" | "SOL" | "BTC"')
    expect(walletPage).toContain("Lightning settlement")
    expect(walletPage).toContain("Managed by PineTree")
    expect(walletPage).toContain("Powered by Speed")
    expect(walletPage).not.toContain("Lightning/Spark wallet")
    expect(walletPage).not.toContain('asset: "LIGHTNING"')
  })

  it("lets merchants choose PineTree BTC Wallet or external BTC wallet inside PineTree", () => {
    expect(walletPage).toContain("Use PineTree BTC Wallet")
    expect(walletPage).toContain("Add external BTC wallet")
    expect(walletPage).toContain("/api/wallets/lightning/settlement")
    expect(engine).toContain('destinationType: "pinetree_btc_wallet"')
    expect(engine).toContain('destinationType: "external_btc_wallet"')
    expect(engine).toContain("ensureDefaultPineTreeBtcPayoutDestination")
  })

  it("shows auto-settlement status and avoids Speed dashboard primary flow", () => {
    expect(walletPage).toContain("Auto-settlement")
    expect(walletPage).toContain("Enable auto-settlement")
    expect(walletPage).toContain("Refresh settlement status")
    expect(walletPage).not.toContain("Go to Speed dashboard")
    expect(walletPage).not.toContain("Open Speed")
    expect(walletPage).not.toContain("Speed account setup")
  })

  it("provider card says PineTree Lightning, not Speed setup", () => {
    expect(providersPage).toContain('name="PineTree Lightning"')
    expect(providersPage).toContain("Processor")
    expect(providersPage).toContain("PineTree Lightning")
    expect(providersPage).toContain("Powered by Speed")
    expect(providersPage).not.toContain("Merchant Speed account")
    expect(providersPage).not.toContain("Speed API keys")
  })

  it("Speed secret is server-only and capability-gated", () => {
    expect(speedClient).toContain("SPEED_API_KEY")
    expect(adapter).not.toContain("NEXT_PUBLIC_SPEED_API_KEY")
    expect(speedClient).not.toContain("NEXT_PUBLIC_SPEED_API_KEY")
    expect(adapter).toContain("SPEED_CONNECT_ENABLED")
    expect(adapter).toContain("SPEED_PAYOUTS_ENABLED")
    expect(adapter).toContain("SPEED_AUTOSWAP_ENABLED")
    expect(adapter).toContain("syncSpeedAutoswapSettings")
    expect(adapter).toContain("Do not fake provider sync")
  })

  it("webhook signature verification happens before settlement job creation", () => {
    expect(eventProcessor).toContain("adapter.verifyWebhook")
    expect(eventProcessor).toContain('throw new Error("Webhook verification failed")')
    const verifyIndex = eventProcessor.indexOf("adapter.verifyWebhook")
    const rejectionIndex = eventProcessor.indexOf('throw new Error("Webhook verification failed")')
    const settlementCallIndex = eventProcessor.lastIndexOf("ensurePineTreeLightningSettlementJob")
    expect(verifyIndex).toBeLessThan(rejectionIndex)
    expect(rejectionIndex).toBeLessThan(settlementCallIndex)
    expect(eventProcessor).toContain("ensureLightningSettlementJobForConfirmedSpeedPayment")
  })

  it("only confirmed Speed Lightning payments create settlement payout jobs", () => {
    expect(engine).toContain('payment.provider !== SPEED_PROVIDER_NAME')
    expect(engine).toContain('String(payment.network || "").toLowerCase() !== "bitcoin_lightning"')
    expect(engine).toContain('String(payment.status || "").toUpperCase() !== "CONFIRMED"')
    expect(engine).toContain("createLightningSettlementPayoutJobIfMissing")
    expect(engine).toContain("idempotencyKey: `lightning-settlement:${payment.id}`")
  })

  it("processor is protected and ignores arbitrary body amount/address", () => {
    expect(route).toContain("INTERNAL_API_SECRET")
    expect(route).toContain("Unauthorized")
    expect(route).toContain("amount and destination address are intentionally ignored")
    expect(route).toContain("processQueuedLightningSettlementPayoutJobs({ limit })")
    expect(engine).toContain("Math.max(1, Math.min(Number(options.limit || 5), 10))")
  })

  it("processor uses saved active destinations and does not double-pay submitted jobs", () => {
    expect(engine).toContain("listQueuedLightningSettlementPayoutJobs")
    expect(payoutJobsDb).toContain('eq("status", "queued")')
    expect(engine).toContain("listMerchantPayoutDestinations")
    expect(engine).toContain("activeOnly: true")
    expect(engine).toContain("Saved active payout destination is required")
    expect(engine).toContain("claimLightningSettlementPayoutJob")
  })
})

describe("Speed Lightning settlement capability flags", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it("reports payout/autoswap/connect availability from env", async () => {
    vi.stubEnv("SPEED_API_KEY", "sk_test_123")
    vi.stubEnv("SPEED_WEBHOOK_SECRET", "wsec_dGVzdA==")
    vi.stubEnv("SPEED_API_BASE_URL", "https://api.tryspeed.test")
    vi.stubEnv("SPEED_CONNECT_ENABLED", "true")
    vi.stubEnv("SPEED_PAYOUTS_ENABLED", "true")
    vi.stubEnv("SPEED_AUTOSWAP_ENABLED", "false")
    vi.stubEnv("INTERNAL_API_SECRET", "internal")

    const { getSpeedLightningCapabilities } = await import("@/providers/speed/speedLightningSettlement")
    const capabilities = getSpeedLightningCapabilities()

    expect(capabilities.connectAvailable).toBe(true)
    expect(capabilities.payoutAvailable).toBe(true)
    expect(capabilities.autoswapAvailable).toBe(false)
    expect(capabilities.missing).toContain("SPEED_AUTOSWAP_ENABLED")
  })
})
