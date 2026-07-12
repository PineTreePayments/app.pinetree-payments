import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class FakeSpeedHeaderAccountIdUnresolvedError extends Error {
    reason: string
    merchantId: string
    constructor(reason: string, merchantId: string) {
      super(`unresolved: ${reason}`)
      this.name = "SpeedHeaderAccountIdUnresolvedError"
      this.reason = reason
      this.merchantId = merchantId
    }
  }

  class FakeSpeedInstantSendNotConfiguredError extends Error {
    reason: string
    constructor(reason: string, detail: string) {
      super(detail)
      this.name = "SpeedInstantSendNotConfiguredError"
      this.reason = reason
    }
  }

  class FakeSpeedInstantSendProviderError extends Error {
    httpStatus: number | null
    retryable: boolean
    providerCode: string | null
    constructor(
      message: string,
      options: { httpStatus?: number | null; retryable: boolean; providerCode?: string | null }
    ) {
      super(message)
      this.name = "SpeedInstantSendProviderError"
      this.httpStatus = options.httpStatus ?? null
      this.retryable = options.retryable
      this.providerCode = options.providerCode ?? null
    }
  }

  class FakePineTreeWalletLightningReceiveNotConfiguredError extends Error {
    merchantId: string
    constructor(merchantId: string) {
      super("not configured")
      this.name = "PineTreeWalletLightningReceiveNotConfiguredError"
      this.merchantId = merchantId
    }
  }

  return {
    getPaymentById: vi.fn(),
    getMerchantLightningProfile: vi.fn(),
    getMerchantNwcSetup: vi.fn(),
    isSpeedPlatformTreasurySweepEnabled: vi.fn(),
    lookupNwcInvoice: vi.fn(),
    resolveSpeedHeaderAccountId: vi.fn(),
    getConnectedAccountBalance: vi.fn(),
    sendToLightningInvoice: vi.fn(),
    createMerchantLightningSweepInvoice: vi.fn(),
    claimLightningSweepForProcessing: vi.fn(),
    createLightningSweepIfMissing: vi.fn(),
    incrementLightningSweepAttempt: vi.fn(),
    listProcessableLightningSweeps: vi.fn(),
    updateLightningSweep: vi.fn(),
    FakeSpeedHeaderAccountIdUnresolvedError,
    FakeSpeedInstantSendNotConfiguredError,
    FakeSpeedInstantSendProviderError,
    FakePineTreeWalletLightningReceiveNotConfiguredError,
  }
})

vi.mock("@/database/payments", () => ({
  getPaymentById: mocks.getPaymentById,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
  getMerchantNwcSetup: mocks.getMerchantNwcSetup,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
}))

vi.mock("@/providers/lightning/nwcClient", () => ({
  lookupNwcInvoice: mocks.lookupNwcInvoice,
}))

vi.mock("@/providers/lightning/speedHeaderAccountResolver", () => ({
  resolveSpeedHeaderAccountId: mocks.resolveSpeedHeaderAccountId,
  SpeedHeaderAccountIdUnresolvedError: mocks.FakeSpeedHeaderAccountIdUnresolvedError,
}))

vi.mock("@/providers/lightning/speedInstantSend", () => ({
  getConnectedAccountBalance: mocks.getConnectedAccountBalance,
  sendToLightningInvoice: mocks.sendToLightningInvoice,
  SpeedInstantSendNotConfiguredError: mocks.FakeSpeedInstantSendNotConfiguredError,
  SpeedInstantSendProviderError: mocks.FakeSpeedInstantSendProviderError,
}))

vi.mock("@/engine/pineTreeWalletLightningInvoice", () => ({
  createMerchantLightningSweepInvoice: mocks.createMerchantLightningSweepInvoice,
  PineTreeWalletLightningReceiveNotConfiguredError: mocks.FakePineTreeWalletLightningReceiveNotConfiguredError,
}))

vi.mock("@/database/merchantLightningSweeps", () => ({
  claimLightningSweepForProcessing: mocks.claimLightningSweepForProcessing,
  createLightningSweepIfMissing: mocks.createLightningSweepIfMissing,
  incrementLightningSweepAttempt: mocks.incrementLightningSweepAttempt,
  listProcessableLightningSweeps: mocks.listProcessableLightningSweeps,
  updateLightningSweep: mocks.updateLightningSweep,
}))

import {
  ensureLightningSweepForConfirmedPayment,
  processOneLightningSweep,
} from "@/engine/lightningSweep"

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment_1",
    merchant_id: "merchant_1",
    provider: "lightning_speed",
    network: "bitcoin_lightning",
    status: "CONFIRMED",
    merchant_amount: 20,
    pinetree_fee: 0.3,
    gross_amount: 20.3,
    currency: "USD",
    metadata: { split: { quotePriceUsd: 60000, merchantNativeAmount: 20 } },
    ...overrides,
  }
}

function lightningProfile(overrides: Record<string, unknown> = {}) {
  return {
    speed_account_id: "acct_123",
    speed_header_account_id: null,
    ...overrides,
  }
}

function sweep(overrides: Record<string, unknown> = {}) {
  return {
    id: "sweep_1",
    merchant_id: "merchant_1",
    source_payment_id: "payment_1",
    speed_connected_account_id: "acct_123",
    speed_header_account_id: null,
    destination_wallet_profile_id: null,
    destination_invoice: null,
    destination_invoice_hash: null,
    destination_invoice_expires_at: null,
    requested_amount_sats: 33333,
    fee_reserve_sats: 0,
    sent_amount_sats: null,
    provider_send_id: null,
    provider_status: null,
    status: "queued",
    attempt_count: 0,
    idempotency_key: "lightning-sweep:v1:merchant_1:payment_1",
    next_attempt_at: null,
    last_attempt_at: null,
    last_error_code: null,
    last_error_message: null,
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  }
}

describe("ensureLightningSweepForConfirmedPayment", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.SPEED_SWEEP_MIN_SATS
    delete process.env.SPEED_SWEEP_FEE_RESERVE_SATS
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.getMerchantLightningProfile.mockResolvedValue(lightningProfile())
    mocks.createLightningSweepIfMissing.mockImplementation(async (input) => sweep({ ...input }))
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("queues exactly one sweep for a verified confirmed Lightning payment", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    const result = await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    expect(result).not.toBeNull()
    expect(mocks.createLightningSweepIfMissing).toHaveBeenCalledTimes(1)
    expect(mocks.createLightningSweepIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_1",
        sourcePaymentId: "payment_1",
        speedConnectedAccountId: "acct_123",
      })
    )
  })

  it("a repeated call for the same payment does not create a second sweep (idempotent creation call)", async () => {
    mocks.getPaymentById.mockResolvedValue(payment())
    await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    expect(mocks.createLightningSweepIfMissing).toHaveBeenCalledTimes(2)
    const [firstCallArgs] = mocks.createLightningSweepIfMissing.mock.calls[0]
    const [secondCallArgs] = mocks.createLightningSweepIfMissing.mock.calls[1]
    expect(firstCallArgs).toEqual(secondCallArgs)
  })

  it("queues no sweep for a non-Lightning network", async () => {
    mocks.getPaymentById.mockResolvedValue(payment({ network: "base" }))
    const result = await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    expect(result).toBeNull()
    expect(mocks.createLightningSweepIfMissing).not.toHaveBeenCalled()
  })

  it("queues no sweep for a non-Speed provider", async () => {
    mocks.getPaymentById.mockResolvedValue(payment({ provider: "stripe" }))
    expect(await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })).toBeNull()
    expect(mocks.createLightningSweepIfMissing).not.toHaveBeenCalled()
  })

  it("queues no sweep for a payment that is not confirmed", async () => {
    mocks.getPaymentById.mockResolvedValue(payment({ status: "PROCESSING" }))
    expect(await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })).toBeNull()
    expect(mocks.createLightningSweepIfMissing).not.toHaveBeenCalled()
  })

  it("queues no sweep in treasury-sweep settlement mode (funds never land in a per-merchant account)", async () => {
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(true)
    mocks.getPaymentById.mockResolvedValue(payment())
    expect(await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })).toBeNull()
    expect(mocks.createLightningSweepIfMissing).not.toHaveBeenCalled()
  })

  it("fails safely (returns null, never throws) when the merchant has no active Speed Custom Connect account mapped", async () => {
    mocks.getMerchantLightningProfile.mockResolvedValue(lightningProfile({ speed_account_id: null }))
    mocks.getPaymentById.mockResolvedValue(payment())
    await expect(ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })).resolves.toBeNull()
    expect(mocks.createLightningSweepIfMissing).not.toHaveBeenCalled()
  })

  it("excludes PineTree's application fee from the swept amount - uses merchant net, not gross", async () => {
    mocks.getPaymentById.mockResolvedValue(
      payment({
        merchant_amount: 20,
        pinetree_fee: 0.3,
        gross_amount: 20.3,
        metadata: { split: { quotePriceUsd: 60000, merchantNativeAmount: 20 } },
      })
    )
    await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    const [args] = mocks.createLightningSweepIfMissing.mock.calls[0]
    // 20 USD net / 60000 USD per BTC * 100_000_000 sats/BTC = 33333 sats (gross would be ~33833).
    expect(args.requestedAmountSats).toBe(33333)
  })

  it("is not rejected by any PineTree-side $20 floor - Instant Send exists specifically for balances under Speed's own $20 minimum", async () => {
    mocks.getPaymentById.mockResolvedValue(
      payment({
        merchant_amount: 2,
        metadata: { split: { quotePriceUsd: 60000, merchantNativeAmount: 2 } },
      })
    )
    const result = await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    expect(result).not.toBeNull()
    expect(mocks.createLightningSweepIfMissing).toHaveBeenCalled()
  })

  it("respects a configured SPEED_SWEEP_MIN_SATS floor", async () => {
    process.env.SPEED_SWEEP_MIN_SATS = "50000"
    mocks.getPaymentById.mockResolvedValue(
      payment({
        merchant_amount: 20,
        metadata: { split: { quotePriceUsd: 60000, merchantNativeAmount: 20 } },
      })
    )
    const result = await ensureLightningSweepForConfirmedPayment({ paymentId: "payment_1" })
    expect(result).toBeNull()
    expect(mocks.createLightningSweepIfMissing).not.toHaveBeenCalled()
  })

  it("returns null when the payment does not exist", async () => {
    mocks.getPaymentById.mockResolvedValue(null)
    expect(await ensureLightningSweepForConfirmedPayment({ paymentId: "missing" })).toBeNull()
  })
})

describe("processOneLightningSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) => sweep({ id }))
    mocks.updateLightningSweep.mockImplementation(async (id: string, patch: Record<string, unknown>) =>
      sweep({ id, ...patch })
    )
    mocks.incrementLightningSweepAttempt.mockImplementation(async (id: string) => sweep({ id, attempt_count: 1 }))
    mocks.getMerchantLightningProfile.mockResolvedValue(lightningProfile({ speed_header_account_id: "acct_confirmed_1" }))
    mocks.resolveSpeedHeaderAccountId.mockReturnValue("acct_confirmed_1")
    mocks.createMerchantLightningSweepInvoice.mockResolvedValue({
      invoice: "lnbc1...",
      paymentHash: "hash-1",
      amountSats: 33333,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      destinationWalletProfileId: "provider_row_1",
    })
    mocks.getConnectedAccountBalance.mockResolvedValue({ availableSats: 100000, asOf: new Date().toISOString(), raw: {} })
    mocks.sendToLightningInvoice.mockResolvedValue({ providerSendId: "send_1", providerStatus: "processing", raw: {} })
    mocks.lookupNwcInvoice.mockResolvedValue({ settled: false, paymentHash: "hash-1", type: "incoming" })
    mocks.getMerchantNwcSetup.mockResolvedValue({ nwcUri: "nostr+walletconnect://x" })
  })

  it("returns 'skipped' when the claim fails (already processing or terminal) - proves only one processor can advance a sweep", async () => {
    mocks.claimLightningSweepForProcessing.mockResolvedValue(null)
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("skipped")
    expect(mocks.updateLightningSweep).not.toHaveBeenCalled()
  })

  it("moves to awaiting_configuration and consumes no attempt when the header account id cannot be resolved", async () => {
    mocks.resolveSpeedHeaderAccountId.mockImplementation(() => {
      throw new mocks.FakeSpeedHeaderAccountIdUnresolvedError("missing", "merchant_1")
    })
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("awaiting_configuration")
    expect(mocks.incrementLightningSweepAttempt).not.toHaveBeenCalled()
    expect(mocks.updateLightningSweep).toHaveBeenCalledWith(
      "sweep_1",
      expect.objectContaining({ status: "awaiting_configuration" })
    )
  })

  it("generates a fresh invoice for the correct merchant when none is on file", async () => {
    await processOneLightningSweep("sweep_1")
    expect(mocks.createMerchantLightningSweepInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: "merchant_1", sweepId: "sweep_1" })
    )
  })

  it("invoice amount matches the eligible net SATS (requested minus fee reserve)", async () => {
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({ id, requested_amount_sats: 10000, fee_reserve_sats: 300 })
    )
    await processOneLightningSweep("sweep_1")
    expect(mocks.createMerchantLightningSweepInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountSats: 9700 })
    )
  })

  it("moves to awaiting_invoice (not a crash) when the merchant has no PineTree Wallet Lightning receive capability", async () => {
    mocks.createMerchantLightningSweepInvoice.mockRejectedValue(
      new mocks.FakePineTreeWalletLightningReceiveNotConfiguredError("merchant_1")
    )
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("awaiting_invoice")
    expect(mocks.incrementLightningSweepAttempt).not.toHaveBeenCalled()
  })

  it("replaces an expired invoice with a fresh one before retrying rather than resending to it", async () => {
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({
        id,
        destination_invoice: "lnbc_expired...",
        destination_invoice_hash: "expired-hash",
        destination_invoice_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
    )
    await processOneLightningSweep("sweep_1")
    expect(mocks.createMerchantLightningSweepInvoice).toHaveBeenCalled()
  })

  it("reuses a still-valid invoice instead of minting a new one", async () => {
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({
        id,
        destination_invoice: "lnbc_valid...",
        destination_invoice_hash: "valid-hash",
        destination_invoice_expires_at: new Date(Date.now() + 600_000).toISOString(),
      })
    )
    await processOneLightningSweep("sweep_1")
    expect(mocks.createMerchantLightningSweepInvoice).not.toHaveBeenCalled()
  })

  it("moves to awaiting_configuration and consumes no attempt when the Speed balance endpoint is unconfigured", async () => {
    mocks.getConnectedAccountBalance.mockRejectedValue(
      new mocks.FakeSpeedInstantSendNotConfiguredError("endpoint_not_configured", "not set")
    )
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("awaiting_configuration")
    expect(mocks.incrementLightningSweepAttempt).not.toHaveBeenCalled()
    expect(mocks.sendToLightningInvoice).not.toHaveBeenCalled()
  })

  it("moves to awaiting_balance and consumes no attempt when available balance is insufficient", async () => {
    mocks.getConnectedAccountBalance.mockResolvedValue({ availableSats: 0, asOf: "", raw: {} })
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("awaiting_balance")
    expect(mocks.incrementLightningSweepAttempt).not.toHaveBeenCalled()
    expect(mocks.sendToLightningInvoice).not.toHaveBeenCalled()
  })

  it("caps the send amount at available balance, never sending more than what Speed reports", async () => {
    mocks.getConnectedAccountBalance.mockResolvedValue({ availableSats: 100, asOf: "", raw: {} })
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({ id, requested_amount_sats: 5000, fee_reserve_sats: 0 })
    )
    await processOneLightningSweep("sweep_1")
    expect(mocks.sendToLightningInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountSats: 100 }))
  })

  it("only consumes an attempt immediately before a real send call, not for balance/invoice/config gaps", async () => {
    await processOneLightningSweep("sweep_1")
    expect(mocks.incrementLightningSweepAttempt).toHaveBeenCalledTimes(1)
  })

  it("passes the sweep's own stable idempotency key to the send call every time (safe for explicit retries)", async () => {
    await processOneLightningSweep("sweep_1")
    const firstCallArgs = mocks.sendToLightningInvoice.mock.calls[0][0]

    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({ id, status: "retryable_failed", attempt_count: 1 })
    )
    await processOneLightningSweep("sweep_1")
    const secondCallArgs = mocks.sendToLightningInvoice.mock.calls[1][0]

    expect(firstCallArgs.idempotencyKey).toBe(secondCallArgs.idempotencyKey)
    expect(firstCallArgs.idempotencyKey).toBe("lightning-sweep:v1:merchant_1:payment_1")
  })

  it("schedules a retry (does not fail permanently) on a temporary/unclassified send failure", async () => {
    mocks.sendToLightningInvoice.mockRejectedValue(new Error("ECONNRESET"))
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("retry_scheduled")
    expect(mocks.updateLightningSweep).toHaveBeenCalledWith(
      "sweep_1",
      expect.objectContaining({ status: "retryable_failed", nextAttemptAt: expect.any(String) })
    )
  })

  it("stops retrying immediately on a deterministic provider rejection", async () => {
    mocks.sendToLightningInvoice.mockRejectedValue(
      new mocks.FakeSpeedInstantSendProviderError("invalid destination", { retryable: false, providerCode: "invalid_destination" })
    )
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("failed")
    expect(mocks.updateLightningSweep).toHaveBeenCalledWith(
      "sweep_1",
      expect.objectContaining({ status: "failed", lastErrorCode: "invalid_destination" })
    )
  })

  it("stops retrying once attempts are exhausted, even for a nominally-retryable failure", async () => {
    process.env.SPEED_SWEEP_MAX_ATTEMPTS = "2"
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) => sweep({ id, attempt_count: 1 }))
    mocks.incrementLightningSweepAttempt.mockImplementation(async (id: string) => sweep({ id, attempt_count: 2 }))
    mocks.sendToLightningInvoice.mockRejectedValue(
      new mocks.FakeSpeedInstantSendProviderError("temporary", { retryable: true, httpStatus: 500 })
    )
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("failed")
    delete process.env.SPEED_SWEEP_MAX_ATTEMPTS
  })

  it("on success, moves to processing and records provider_send_id + sent amount without marking confirmed yet", async () => {
    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("sent")
    expect(mocks.updateLightningSweep).toHaveBeenCalledWith(
      "sweep_1",
      expect.objectContaining({ status: "processing", providerSendId: "send_1", sentAmountSats: expect.any(Number) })
    )
  })

  it("confirms a sweep via a verified destination-wallet receipt (NWC lookup_invoice settled), not merely because the send was accepted", async () => {
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({ id, provider_send_id: "send_1", destination_invoice_hash: "hash-1", status: "processing" })
    )
    mocks.lookupNwcInvoice.mockResolvedValue({ settled: true, paymentHash: "hash-1", type: "incoming" })

    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("confirmed")
    expect(mocks.updateLightningSweep).toHaveBeenCalledWith(
      "sweep_1",
      expect.objectContaining({ status: "confirmed", completedAt: expect.any(String) })
    )
    expect(mocks.sendToLightningInvoice).not.toHaveBeenCalled()
  })

  it("does not confirm (and does not resend) while the destination invoice is not yet settled", async () => {
    mocks.claimLightningSweepForProcessing.mockImplementation(async (id: string) =>
      sweep({ id, provider_send_id: "send_1", destination_invoice_hash: "hash-1", status: "processing" })
    )
    mocks.lookupNwcInvoice.mockResolvedValue({ settled: false, paymentHash: "hash-1", type: "incoming" })

    const outcome = await processOneLightningSweep("sweep_1")
    expect(outcome).toBe("still_processing")
    expect(mocks.sendToLightningInvoice).not.toHaveBeenCalled()
    expect(mocks.updateLightningSweep).not.toHaveBeenCalledWith("sweep_1", expect.objectContaining({ status: "confirmed" }))
  })
})

describe("engine/lightningSweep.ts never touches payment status", () => {
  it("does not import payment status mutation helpers - a failed sweep must never affect the underlying payment's CONFIRMED status", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const src = fs.readFileSync(path.join(process.cwd(), "engine/lightningSweep.ts"), "utf8")
    expect(src).not.toContain("updatePaymentStatus")
    expect(src).not.toContain("advancePaymentToTargetStatus")
    expect(src).not.toContain("markPaymentIncomplete")
  })
})
