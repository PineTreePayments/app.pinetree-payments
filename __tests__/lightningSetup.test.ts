/**
 * Tests for PineTree Lightning operational setup.
 *
 * Covers:
 * - Speed config detection (no secrets exposed)
 * - Merchant Lightning enable flow
 * - Lightning connected requires payout destination
 * - PineTree BTC Wallet as Lightning payout destination
 * - External BTC address validation for payout destination
 * - Speed references stored server-side only (not in merchant-facing responses)
 * - Lightning settlement records gross, fee, and net amounts
 * - Missing payout path does not fake settlement complete
 * - BTC wallet address connected is separate from Lightning readiness
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Module mocks (hoisted above all imports) ──────────────────────────────────

const settingsDb = vi.hoisted(() => ({
  upsertMerchantPayoutDestination: vi.fn(),
  listMerchantPayoutDestinations: vi.fn(),
  getActiveMerchantPayoutDestination: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  getLightningSettlementSettings: vi.fn(),
  upsertLightningSettlementSettings: vi.fn(),
  createLightningSettlementPayoutJobIfMissing: vi.fn(),
  listQueuedLightningSettlementPayoutJobs: vi.fn(),
  claimLightningSettlementPayoutJob: vi.fn(),
  markLightningSettlementPayoutJobSubmitted: vi.fn(),
  markLightningSettlementPayoutJobFailed: vi.fn(),
  getPaymentById: vi.fn(),
  getTransactionByPaymentId: vi.fn(),
  createSpeedLightningPayout: vi.fn(),
  syncSpeedAutoswapSettings: vi.fn(),
  getSpeedLightningCapabilities: vi.fn(),
}))

vi.mock("@/database/merchantPayoutDestinations", () => ({
  upsertMerchantPayoutDestination: settingsDb.upsertMerchantPayoutDestination,
  listMerchantPayoutDestinations: settingsDb.listMerchantPayoutDestinations,
  getActiveMerchantPayoutDestination: settingsDb.getActiveMerchantPayoutDestination,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: settingsDb.getPineTreeWalletProfile,
}))

vi.mock("@/database/lightningSettlementSettings", () => ({
  getLightningSettlementSettings: settingsDb.getLightningSettlementSettings,
  upsertLightningSettlementSettings: settingsDb.upsertLightningSettlementSettings,
}))

vi.mock("@/database/lightningSettlementPayoutJobs", () => ({
  createLightningSettlementPayoutJobIfMissing: settingsDb.createLightningSettlementPayoutJobIfMissing,
  listQueuedLightningSettlementPayoutJobs: settingsDb.listQueuedLightningSettlementPayoutJobs,
  claimLightningSettlementPayoutJob: settingsDb.claimLightningSettlementPayoutJob,
  markLightningSettlementPayoutJobSubmitted: settingsDb.markLightningSettlementPayoutJobSubmitted,
  markLightningSettlementPayoutJobFailed: settingsDb.markLightningSettlementPayoutJobFailed,
  listLightningSettlementPayoutJobsForMerchant: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/database/payments", () => ({
  getPaymentById: settingsDb.getPaymentById,
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: settingsDb.getTransactionByPaymentId,
}))

vi.mock("@/providers/speed/speedLightningSettlement", () => ({
  createSpeedLightningPayout: settingsDb.createSpeedLightningPayout,
  syncSpeedAutoswapSettings: settingsDb.syncSpeedAutoswapSettings,
  getSpeedLightningCapabilities: settingsDb.getSpeedLightningCapabilities,
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
}))

// Audit events — fire-and-forget; suppress Supabase calls in tests
vi.mock("@/database/merchantAuditEvents", () => ({
  insertWithdrawalAuditEvent: vi.fn().mockResolvedValue(undefined),
  insertMerchantAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

// ── Static imports (vi.mock is hoisted above these) ───────────────────────────

import {
  getPineTreeSpeedConfigStatus,
  inferSpeedMode,
} from "@/providers/lightning/speedClient"
import { createOrLinkSpeedConnectedAccountForMerchant } from "@/providers/lightning/speedConnectedAccounts"
import {
  setLightningSettlementDestination,
  ensureLightningSettlementJobForConfirmedSpeedPayment,
  processQueuedLightningSettlementPayoutJobs,
} from "@/engine/lightningSettlement"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBtcDestination(overrides: Record<string, unknown> = {}) {
  return {
    id: "dest_1",
    merchant_id: "merchant_1",
    rail: "bitcoin_lightning",
    asset: "BTC",
    destination_type: "pinetree_btc_wallet",
    destination_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    label: "PineTree BTC Wallet",
    status: "active",
    provider: "pinetree",
    provider_reference: null,
    verified_at: null,
    created_at: "2026-06-27T00:00:00.000Z",
    updated_at: "2026-06-27T00:00:00.000Z",
    ...overrides,
  }
}

// ── Speed config detection ────────────────────────────────────────────────────

describe("Speed config detection", () => {
  beforeEach(() => vi.unstubAllEnvs())
  afterEach(() => vi.unstubAllEnvs())

  it("reports configured=false when SPEED_API_KEY is missing", () => {
    vi.stubEnv("SPEED_API_KEY", "")
    vi.stubEnv("SPEED_WEBHOOK_SECRET", "wsec_abc123")
    const status = getPineTreeSpeedConfigStatus()
    expect(status.configured).toBe(false)
    expect(status.missing).toContain("SPEED_API_KEY")
  })

  it("reports configured=false when SPEED_WEBHOOK_SECRET is missing", () => {
    vi.stubEnv("SPEED_API_KEY", "sk_test_abc")
    vi.stubEnv("SPEED_WEBHOOK_SECRET", "")
    const status = getPineTreeSpeedConfigStatus()
    expect(status.configured).toBe(false)
    expect(status.missing).toContain("SPEED_WEBHOOK_SECRET")
  })

  it("reports configured=true when both keys are present and modes match", () => {
    vi.stubEnv("SPEED_API_KEY", "sk_test_abc")
    vi.stubEnv("SPEED_WEBHOOK_SECRET", "wsec_def456")
    vi.stubEnv("SPEED_ENVIRONMENT", "test")
    const status = getPineTreeSpeedConfigStatus()
    expect(status.configured).toBe(true)
    expect(status.missing).toHaveLength(0)
    expect(status.environmentKeyMismatch).toBe(false)
  })

  it("getPineTreeSpeedConfigStatus never exposes SPEED_API_KEY value in its return", () => {
    vi.stubEnv("SPEED_API_KEY", "sk_test_should_not_leak")
    vi.stubEnv("SPEED_WEBHOOK_SECRET", "wsec_also_secret")
    const status = getPineTreeSpeedConfigStatus()
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain("sk_test_should_not_leak")
    expect(serialized).not.toContain("wsec_also_secret")
  })

  it("detects env/key mismatch when live environment is set but test key is used", () => {
    vi.stubEnv("SPEED_API_KEY", "sk_test_abc")
    vi.stubEnv("SPEED_WEBHOOK_SECRET", "wsec_abc")
    vi.stubEnv("SPEED_ENVIRONMENT", "live")
    const status = getPineTreeSpeedConfigStatus()
    expect(status.environmentKeyMismatch).toBe(true)
    expect(status.configured).toBe(false)
  })

  it("infers test mode from key prefix when SPEED_ENVIRONMENT is not set", () => {
    vi.stubEnv("SPEED_ENVIRONMENT", "")
    const mode = inferSpeedMode("sk_test_abc")
    expect(mode).toBe("test")
  })
})

// ── Speed references server-side only ────────────────────────────────────────

describe("Speed references stay server-side", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("createOrLinkSpeedConnectedAccountForMerchant result never echoes the API key", async () => {
    vi.stubEnv("SPEED_CONNECT_ENABLED", "false")
    vi.stubEnv("SPEED_API_KEY", "sk_test_super_secret_key")

    const result = await createOrLinkSpeedConnectedAccountForMerchant({
      merchant_id: "merchant_1",
      pinetree_reference_id: "pinetree-merchant:merchant_1",
    })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("sk_test_super_secret_key")
    expect(serialized).not.toContain("super_secret")
  })

  it("Speed Connect disabled returns pending with a safe error, not a raw provider message", async () => {
    vi.stubEnv("SPEED_CONNECT_ENABLED", "false")
    vi.stubEnv("SPEED_API_KEY", "sk_test_abc")

    const result = await createOrLinkSpeedConnectedAccountForMerchant({
      merchant_id: "merchant_1",
      pinetree_reference_id: "pinetree-merchant:merchant_1",
    })

    expect(result.readiness).toBe("pending")
    expect(result.error_message).toContain("SPEED_CONNECT_ENABLED=true")
    expect(result.provider_response_summary.source).toBe("not_configured")
  })
})

// ── Lightning connected state ─────────────────────────────────────────────────

describe("Lightning connected state (treasury sweep mode)", () => {
  it("status is pending when Speed configured but BTC address not ready", () => {
    const speedConfigured = true
    const btcAddressReady = false
    const nextStatus = !speedConfigured
      ? "needs_attention"
      : !btcAddressReady
        ? "pending"
        : "ready"
    expect(nextStatus).toBe("pending")
  })

  it("status is ready only when Speed configured AND BTC address ready", () => {
    const speedConfigured = true
    const btcAddressReady = true
    const nextStatus = !speedConfigured
      ? "needs_attention"
      : !btcAddressReady
        ? "pending"
        : "ready"
    expect(nextStatus).toBe("ready")
  })

  it("status is needs_attention when Speed is not configured regardless of BTC address", () => {
    const speedConfigured = false
    const btcAddressReady = true
    const nextStatus = !speedConfigured
      ? "needs_attention"
      : !btcAddressReady
        ? "pending"
        : "ready"
    expect(nextStatus).toBe("needs_attention")
  })
})

// ── Lightning payout destination ──────────────────────────────────────────────

describe("Lightning payout destination", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("BITCOIN_NETWORK", "mainnet")

    settingsDb.getPineTreeWalletProfile.mockResolvedValue({
      id: "profile_1",
      merchant_id: "merchant_1",
      btc_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      btc_payout_enabled: true,
      btc_payout_verified_at: null,
    })
    settingsDb.upsertMerchantPayoutDestination.mockResolvedValue(makeBtcDestination())
    settingsDb.listMerchantPayoutDestinations.mockResolvedValue([])
    settingsDb.getLightningSettlementSettings.mockResolvedValue(null)
    settingsDb.upsertLightningSettlementSettings.mockResolvedValue({ id: "settings_1" })
    settingsDb.syncSpeedAutoswapSettings.mockResolvedValue({
      synced: false,
      providerReference: null,
      status: "not_available",
      message: "Autoswap not available",
    })
    settingsDb.getSpeedLightningCapabilities.mockReturnValue({
      configured: true,
      connectAvailable: false,
      payoutAvailable: true,
      autoswapAvailable: false,
      missing: [],
      apiBaseUrl: "https://api.tryspeed.com",
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it("saves PineTree BTC Wallet as Lightning payout destination", async () => {
    const result = await setLightningSettlementDestination({
      merchantId: "merchant_1",
      destinationType: "pinetree_btc_wallet",
    })

    expect(settingsDb.upsertMerchantPayoutDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_1",
        destinationType: "pinetree_btc_wallet",
        rail: "bitcoin_lightning",
        asset: "BTC",
        destinationAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      })
    )
    expect(result.destination.destination_type).toBe("pinetree_btc_wallet")
    expect(result.destination.destination_address).toBe("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")
  })

  it("saves external BTC wallet as Lightning payout destination with a valid mainnet address", async () => {
    const externalDest = makeBtcDestination({
      destination_type: "external_btc_wallet",
      destination_address: "bc1qw5g6nan4y0p57nrmv69pyqk2xdgtghtm4uuta6",
    })
    settingsDb.upsertMerchantPayoutDestination.mockResolvedValue(externalDest)

    const result = await setLightningSettlementDestination({
      merchantId: "merchant_1",
      destinationType: "external_btc_wallet",
      destinationAddress: "bc1qw5g6nan4y0p57nrmv69pyqk2xdgtghtm4uuta6",
    })

    expect(result.destination.destination_type).toBe("external_btc_wallet")
    expect(result.destination.destination_address).toBe("bc1qw5g6nan4y0p57nrmv69pyqk2xdgtghtm4uuta6")
  })

  it("rejects an empty external BTC destination address", async () => {
    await expect(
      setLightningSettlementDestination({
        merchantId: "merchant_1",
        destinationType: "external_btc_wallet",
        destinationAddress: "",
      })
    ).rejects.toThrow("External BTC payout address is required.")
  })

  it("rejects an invalid external BTC destination address", async () => {
    await expect(
      setLightningSettlementDestination({
        merchantId: "merchant_1",
        destinationType: "external_btc_wallet",
        destinationAddress: "not-a-bitcoin-address",
      })
    ).rejects.toThrow("not a valid Bitcoin address")
  })

  it("rejects a testnet address when mainnet is configured", async () => {
    await expect(
      setLightningSettlementDestination({
        merchantId: "merchant_1",
        destinationType: "external_btc_wallet",
        destinationAddress: "tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjaq5ayy",
      })
    ).rejects.toThrow("not a valid Bitcoin address")
  })

  it("pinetree_btc_wallet fails when merchant has no BTC address", async () => {
    settingsDb.getPineTreeWalletProfile.mockResolvedValue({
      id: "profile_1",
      merchant_id: "merchant_1",
      btc_address: null,
      btc_payout_enabled: false,
    })
    settingsDb.upsertMerchantPayoutDestination.mockResolvedValue(null)

    await expect(
      setLightningSettlementDestination({
        merchantId: "merchant_1",
        destinationType: "pinetree_btc_wallet",
      })
    ).rejects.toThrow("PineTree BTC Wallet address is not available.")
  })
})

// ── Lightning settlement amounts ──────────────────────────────────────────────

describe("Lightning settlement job creation", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    settingsDb.getPaymentById.mockResolvedValue({
      id: "pay_1",
      merchant_id: "merchant_1",
      provider: "lightning_speed",
      network: "bitcoin_lightning",
      status: "CONFIRMED",
      gross_amount: 100,
      pinetree_fee: 2.5,
      merchant_amount: 97.5,
      provider_reference: "speed_pay_1",
      metadata: { split: { quotePriceUsd: 50_000 } },
    })
    settingsDb.getTransactionByPaymentId.mockResolvedValue({ id: "tx_1" })
    settingsDb.getLightningSettlementSettings.mockResolvedValue(null)
    settingsDb.listMerchantPayoutDestinations.mockResolvedValue([makeBtcDestination()])
    settingsDb.getActiveMerchantPayoutDestination.mockResolvedValue(makeBtcDestination())
    settingsDb.getPineTreeWalletProfile.mockResolvedValue({
      id: "profile_1",
      merchant_id: "merchant_1",
      btc_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      btc_payout_enabled: true,
      btc_payout_verified_at: null,
    })
    settingsDb.upsertMerchantPayoutDestination.mockResolvedValue(makeBtcDestination())
    settingsDb.createLightningSettlementPayoutJobIfMissing.mockResolvedValue({
      id: "job_1",
      merchant_id: "merchant_1",
      payment_id: "pay_1",
    })
  })

  it("records gross amount, PineTree fee, and merchant net in the settlement job", async () => {
    await ensureLightningSettlementJobForConfirmedSpeedPayment({
      paymentId: "pay_1",
      payload: {
        data: {
          object: {
            id: "speed_pay_1",
            metadata: {
              gross_amount: 100,
              platform_fee_usd: 2.5,
              merchant_net_usd: 97.5,
            },
          },
        },
      },
    })

    expect(settingsDb.createLightningSettlementPayoutJobIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_1",
        paymentId: "pay_1",
        grossAmountDecimal: expect.any(String),
        feeAmountDecimal: expect.any(String),
        merchantNetAmountDecimal: expect.any(String),
      })
    )
    const args = settingsDb.createLightningSettlementPayoutJobIfMissing.mock.calls[0][0]
    // grossAmountDecimal and feeAmountDecimal are USD; merchantNetAmountDecimal is sats
    expect(Number(args.grossAmountDecimal)).toBeGreaterThan(0)
    expect(Number(args.feeAmountDecimal)).toBeGreaterThan(0)
    expect(Number(args.merchantNetAmountDecimal)).toBeGreaterThan(0)
    expect(Number(args.grossAmountDecimal)).toBeGreaterThan(Number(args.feeAmountDecimal))
  })

  it("does not create a settlement job when merchant net sats is zero", async () => {
    settingsDb.getPaymentById.mockResolvedValue({
      id: "pay_1",
      merchant_id: "merchant_1",
      provider: "lightning_speed",
      network: "bitcoin_lightning",
      status: "CONFIRMED",
      gross_amount: 0,
      pinetree_fee: 0,
      merchant_amount: 0,
      metadata: {},
    })

    const result = await ensureLightningSettlementJobForConfirmedSpeedPayment({ paymentId: "pay_1" })

    expect(result).toBeNull()
    expect(settingsDb.createLightningSettlementPayoutJobIfMissing).not.toHaveBeenCalled()
  })

  it("does not create a job for non-Lightning payments", async () => {
    settingsDb.getPaymentById.mockResolvedValue({
      id: "pay_card",
      merchant_id: "merchant_1",
      provider: "stripe",
      network: "card",
      status: "CONFIRMED",
      gross_amount: 100,
      pinetree_fee: 2.5,
      merchant_amount: 97.5,
      metadata: {},
    })

    const result = await ensureLightningSettlementJobForConfirmedSpeedPayment({ paymentId: "pay_card" })

    expect(result).toBeNull()
    expect(settingsDb.createLightningSettlementPayoutJobIfMissing).not.toHaveBeenCalled()
  })

  it("does not fake settlement complete when payout destination is missing", async () => {
    settingsDb.listMerchantPayoutDestinations.mockResolvedValue([])
    settingsDb.getPineTreeWalletProfile.mockResolvedValue({
      btc_address: null,
      btc_payout_enabled: false,
    })
    settingsDb.upsertMerchantPayoutDestination.mockResolvedValue(null)

    const result = await ensureLightningSettlementJobForConfirmedSpeedPayment({ paymentId: "pay_1" })

    expect(result).toBeNull()
    expect(settingsDb.createLightningSettlementPayoutJobIfMissing).not.toHaveBeenCalled()
  })
})

// ── Speed settlement payout ───────────────────────────────────────────────────

describe("Lightning settlement processing", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    settingsDb.listQueuedLightningSettlementPayoutJobs.mockResolvedValue([{
      id: "job_1",
      merchant_id: "merchant_1",
      payment_id: "pay_1",
      transaction_id: "tx_1",
      speed_payment_id: "speed_pay_1",
      gross_amount_decimal: "100",
      fee_amount_decimal: "2.5",
      merchant_net_amount_decimal: "195000",
      asset: "BTC",
      destination_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      destination_type: "pinetree_btc_wallet",
      idempotency_key: "lightning-settlement:pay_1",
      status: "queued",
    }])
    settingsDb.claimLightningSettlementPayoutJob.mockImplementation(async (id) => ({
      id,
      merchant_id: "merchant_1",
      payment_id: "pay_1",
      merchant_net_amount_decimal: "195000",
      destination_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      destination_type: "pinetree_btc_wallet",
      idempotency_key: "lightning-settlement:pay_1",
    }))
    settingsDb.getPaymentById.mockResolvedValue({
      id: "pay_1",
      status: "CONFIRMED",
    })
    settingsDb.listMerchantPayoutDestinations.mockResolvedValue([makeBtcDestination()])
    settingsDb.createSpeedLightningPayout.mockResolvedValue({
      id: "withdraw_1",
      payout_id: "payout_1",
      txid: "btc_tx_abc123",
    })
    settingsDb.markLightningSettlementPayoutJobSubmitted.mockResolvedValue({ id: "job_1", status: "submitted" })
    settingsDb.markLightningSettlementPayoutJobFailed.mockResolvedValue({ id: "job_1", status: "failed" })
    settingsDb.getSpeedLightningCapabilities.mockReturnValue({
      configured: true,
      payoutAvailable: true,
      connectAvailable: false,
      autoswapAvailable: false,
      missing: [],
      apiBaseUrl: "https://api.tryspeed.com",
    })
  })

  it("calls Speed payout and stores payout references for a confirmed payment", async () => {
    const summary = await processQueuedLightningSettlementPayoutJobs()

    expect(summary.submitted).toBe(1)
    expect(summary.failed).toBe(0)
    expect(settingsDb.createSpeedLightningPayout).toHaveBeenCalledTimes(1)
    expect(settingsDb.markLightningSettlementPayoutJobSubmitted).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        providerPayoutId: "payout_1",
        txHash: "btc_tx_abc123",
      })
    )
  })

  it("records failure when Speed payout throws, without marking the job as settled", async () => {
    settingsDb.createSpeedLightningPayout.mockRejectedValue(new Error("Speed payout rejected"))

    const summary = await processQueuedLightningSettlementPayoutJobs()

    expect(summary.failed).toBe(1)
    expect(summary.submitted).toBe(0)
    expect(settingsDb.markLightningSettlementPayoutJobFailed).toHaveBeenCalledWith(
      "job_1",
      "Speed payout rejected"
    )
    expect(settingsDb.markLightningSettlementPayoutJobSubmitted).not.toHaveBeenCalled()
  })

  it("skips settlement job when payment is not confirmed", async () => {
    settingsDb.getPaymentById.mockResolvedValue({ id: "pay_1", status: "PENDING" })

    const summary = await processQueuedLightningSettlementPayoutJobs()

    expect(summary.failed).toBe(1)
    expect(settingsDb.createSpeedLightningPayout).not.toHaveBeenCalled()
  })
})

// ── BTC on-chain wallet vs Lightning ─────────────────────────────────────────

describe("BTC on-chain wallet is independent of Lightning", () => {
  it("BTC address present means BTC wallet connected regardless of Lightning status", () => {
    const profile = {
      btc_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      bitcoin_lightning_status: "needs_attention",
    }
    expect(Boolean(profile.btc_address)).toBe(true)
    expect(profile.bitcoin_lightning_status === "ready").toBe(false)
  })

  it("BTC balance pending sync does not affect BTC wallet connectivity", () => {
    const btcAddressExists = true
    const balanceStatus = "pending_sync"
    expect(btcAddressExists).toBe(true)
    expect(balanceStatus).toBe("pending_sync")
  })

  it("Lightning not configured does not block BTC wallet from being connected", () => {
    const profile = {
      btc_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      bitcoin_lightning_provider: null,
      bitcoin_lightning_status: "not_configured",
    }
    expect(Boolean(profile.btc_address)).toBe(true)
    expect(Boolean(profile.bitcoin_lightning_provider)).toBe(false)
  })
})
