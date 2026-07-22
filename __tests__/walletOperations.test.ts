import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WalletProviderAdapter } from "@/engine/wallet/walletProviderAdapter"

function operationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-1",
    merchant_id: "merchant-1",
    provider: "speed",
    provider_account_id: "acct_fake_1",
    operation_type: "WITHDRAWAL",
    direction: "debit",
    status: "CREATED",
    asset: "SATS",
    network: "",
    amount_base_units: "1000",
    fee_base_units: null,
    destination_summary: "lnbc1...abcd",
    tx_hash: null,
    explorer_url: null,
    provider_reference: null,
    provider_transaction_id: null,
    provider_secondary_reference: null,
    provider_created_at: null,
    provider_status: null,
    raw_provider_status: null,
    failure_code: null,
    failure_reason: null,
    idempotency_key: "key-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    submitted_at: null,
    confirmed_at: null,
    failed_at: null,
    dispatch_started_at: null,
    dispatch_completed_at: null,
    provider_request_key: null,
    provider_request_attempted: null,
    provider_response_received: null,
    provider_acceptance_known: null,
    provider_acceptance_unknown: null,
    persistence_after_acceptance_failed: null,
    ...overrides,
  }
}

/** A fake, non-Speed adapter - proves the engine is genuinely provider-agnostic, not secretly coupled to Speed. */
function fakeAdapter(overrides: Partial<WalletProviderAdapter> = {}): WalletProviderAdapter {
  return {
    provider: "fake-provider",
    providerDisplayName: "Fake Provider",
    resolveContext: vi.fn(),
    getCapabilities: vi.fn().mockResolvedValue({
      balances: false,
      withdrawals: false,
      payouts: false,
      swaps: false,
      automaticPayouts: false,
      automaticConversion: false,
    }),
    ...overrides,
  }
}

const fakeContext = { merchantId: "merchant-1", providerAccountId: "acct_fake_1" }

describe("engine/wallet/walletOperations - provider-agnostic dispatch", () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.SPEED_WITHDRAWAL_FEE_BUFFER_SATS
    delete process.env.SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS
    delete process.env.SPEED_ONCHAIN_WITHDRAWAL_FEE_BUFFER_SATS
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({
      listWalletBalanceSnapshots: vi.fn().mockResolvedValue([]),
      upsertWalletBalanceSnapshot: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock("@/engine/wallet/walletProviderResolution")
    vi.doUnmock("@/database/merchantWalletOperations")
    vi.doUnmock("@/database/merchantWalletBalanceSnapshots")
  })

  it("rejects a withdrawal with a missing Idempotency-Key before resolving a provider or touching the database", async () => {
    const resolveMerchantWalletProvider = vi.fn()
    const createWalletOperation = vi.fn()
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))

    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(
      createWalletWithdrawal("merchant-1", { asset: "SATS", amountDecimal: "1000", destination: "lnbc1...", idempotencyKey: "" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" })
    expect(createWalletOperation).not.toHaveBeenCalled()
  })

  it("rejects an unsupported asset", async () => {
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider: vi.fn() }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(
      createWalletWithdrawal("merchant-1", { asset: "DOGE", amountDecimal: "1", destination: "x", idempotencyKey: "k1" })
    ).rejects.toMatchObject({ code: "WALLET_VALIDATION_ERROR" })
  })

  it("rejects a zero amount", async () => {
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider: vi.fn() }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(
      createWalletWithdrawal("merchant-1", { asset: "SATS", amountDecimal: "0", destination: "lnbc1...", idempotencyKey: "k1" })
    ).rejects.toMatchObject({ code: "WALLET_VALIDATION_ERROR" })
  })

  it("propagates WALLET_PROVIDER_NOT_CONFIGURED from provider resolution unchanged", async () => {
    const resolveMerchantWalletProvider = vi.fn().mockRejectedValue(
      Object.assign(new Error("no provider"), { code: "WALLET_PROVIDER_NOT_CONFIGURED" })
    )
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(
      createWalletWithdrawal("merchant-1", { asset: "SATS", amountDecimal: "1000", destination: "lnbc1...", idempotencyKey: "k1" })
    ).rejects.toMatchObject({ code: "WALLET_PROVIDER_NOT_CONFIGURED" })
  })

  it("creates an operation row and marks it FAILED with WALLET_CAPABILITY_UNAVAILABLE when the resolved adapter does not support the capability", async () => {
    const adapter = fakeAdapter()
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const created = operationRow()
    const failed = operationRow({ status: "FAILED", failure_code: "WALLET_CAPABILITY_UNAVAILABLE" })
    const createWalletOperation = vi.fn().mockResolvedValue({ operation: created, created: true })
    const updateWalletOperation = vi.fn().mockResolvedValue(failed)
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))

    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    const result = await createWalletWithdrawal("merchant-1", {
      asset: "SATS",
      amountDecimal: "1000",
      destination: "lnbc1qqqqqqqqqqqqqqqqqqqq",
      idempotencyKey: "key-1",
    })

    expect(result.capabilityAvailable).toBe(false)
    expect(result.operation.status).toBe("FAILED")
    expect(updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({ status: "FAILED", failureCode: "WALLET_CAPABILITY_UNAVAILABLE" })
    )
  })

  it("calls the resolved adapter's createWithdrawal and reconciles the operation when the capability is available - proves generic dispatch, not a hardcoded provider call", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: "fake_ref_1",
      providerStatus: "processing",
      status: "PROCESSING",
    })
    const adapter = fakeAdapter({
      getCapabilities: vi.fn().mockResolvedValue({
        balances: false,
        withdrawals: true,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      }),
      createWithdrawal,
    })
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const created = operationRow()
    const reconciled = operationRow({ status: "PROCESSING" })
    const createWalletOperation = vi.fn().mockResolvedValue({ operation: created, created: true })
    const updateWalletOperation = vi.fn().mockResolvedValue(reconciled)
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))

    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    const result = await createWalletWithdrawal("merchant-1", {
      asset: "SATS",
      amountDecimal: "1000",
      destination: "lnbc1qqqqqqqqqqqqqqqqqqqq",
      idempotencyKey: "key-1",
    })

    expect(createWithdrawal).toHaveBeenCalledWith(
      fakeContext,
      expect.objectContaining({ asset: "SATS", amountBaseUnits: BigInt(1000) })
    )
    expect(result.capabilityAvailable).toBe(true)
    expect(result.operation.status).toBe("PROCESSING")
    // submittedAt must be stamped the moment the operation moves to
    // PROCESSING, independent of whether/when it's later reconciled -
    // otherwise merchant_wallet_operations has no lifecycle timestamp parity
    // with wallet_withdrawal_requests (which already tracks submitted_at).
    expect(updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      created.id,
      expect.objectContaining({ status: "PROCESSING", submittedAt: expect.any(String) })
    )
  })

  it("stamps confirmedAt (and completedAt) when the adapter reports COMPLETED, and failedAt when it reports FAILED", async () => {
    const confirmedResult = {
      providerReference: "fake_ref_2",
      providerStatus: "paid",
      status: "COMPLETED" as const,
    }
    const adapter = fakeAdapter({
      getCapabilities: vi.fn().mockResolvedValue({
        balances: false,
        withdrawals: true,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      }),
      createWithdrawal: vi.fn().mockResolvedValue(confirmedResult),
    })
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const created = operationRow()
    const updateWalletOperation = vi.fn().mockResolvedValue(operationRow({ status: "COMPLETED" }))
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn().mockResolvedValue({ operation: created, created: true }),
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))

    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await createWalletWithdrawal("merchant-1", {
      asset: "SATS",
      amountDecimal: "1000",
      destination: "lnbc1qqqqqqqqqqqqqqqqqqqq",
      idempotencyKey: "key-2",
    })

    expect(updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      created.id,
      expect.objectContaining({
        status: "COMPLETED",
        completedAt: expect.any(String),
        confirmedAt: expect.any(String),
        failedAt: undefined,
      })
    )
  })

  it("rejects a Speed withdrawal before /send when amount plus fee reserve exceeds live available sats", async () => {
    process.env.SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS = "500"
    const createWithdrawal = vi.fn()
    const adapter = fakeAdapter({
      provider: "speed",
      providerDisplayName: "Speed",
      requiresFreshBalanceForWithdrawal: true,
      getCapabilities: vi.fn().mockResolvedValue({
        balances: true,
        withdrawals: true,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      }),
      getBalances: vi.fn().mockResolvedValue([{
        asset: "BTC",
        network: "bitcoin_lightning",
        availableBaseUnits: BigInt(2969),
        pendingBaseUnits: BigInt(0),
        totalBaseUnits: BigInt(2969),
      }]),
      createWithdrawal,
    })
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({
      provider: "speed",
      adapter,
      context: { merchantId: "merchant-1", providerAccountId: "acct_speed_1" },
    })
    const created = operationRow({ amount_base_units: "2969" })
    const failed = operationRow({ status: "FAILED", failure_code: "INSUFFICIENT_BALANCE" })
    const createWalletOperation = vi.fn().mockResolvedValue({ operation: created, created: true })
    const updateWalletOperation = vi.fn().mockResolvedValue(failed)
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))

    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(
      createWalletWithdrawal("merchant-1", {
        asset: "SATS",
        amountDecimal: "2969",
        destination: "merchant@example.com",
        idempotencyKey: "key-1",
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE", retryable: false })

    expect(updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "FAILED",
        failureCode: "INSUFFICIENT_BALANCE",
        failureReason: expect.stringContaining("estimated provider/network fee"),
      })
    )
    expect(createWithdrawal).not.toHaveBeenCalled()
  })

  it("returns the existing operation unchanged on a duplicate idempotency key without calling the adapter again", async () => {
    const adapter = fakeAdapter({
      createWithdrawal: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        balances: false,
        withdrawals: false,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      }),
    })
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const existing = operationRow({
      status: "FAILED",
      failure_code: "WALLET_CAPABILITY_UNAVAILABLE",
      destination_summary: "lnbc1q...qqqq",
    })
    const createWalletOperation = vi.fn().mockResolvedValue({ operation: existing, created: false })
    const updateWalletOperation = vi.fn()
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))

    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    const result = await createWalletWithdrawal("merchant-1", {
      asset: "SATS",
      amountDecimal: "1000",
      destination: "lnbc1qqqqqqqqqqqqqqqqqqqq",
      idempotencyKey: "key-1",
    })

    expect(result.operation.id).toBe(existing.id)
    expect(updateWalletOperation).not.toHaveBeenCalled()
    expect(adapter.createWithdrawal).not.toHaveBeenCalled()
  })

  it("looking up a wallet operation that does not belong to the merchant returns WALLET_OPERATION_NOT_FOUND, never another merchant's row", async () => {
    const adapter = fakeAdapter()
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const getWalletOperationForMerchant = vi.fn().mockResolvedValue(null)
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant,
      listWalletOperations: vi.fn(),
    }))
    const { getWalletOperation } = await import("@/engine/wallet/walletOperations")
    await expect(getWalletOperation("merchant-1", "op-owned-by-someone-else")).rejects.toMatchObject({
      code: "WALLET_OPERATION_NOT_FOUND",
    })
    expect(getWalletOperationForMerchant).toHaveBeenCalledWith("merchant-1", "op-owned-by-someone-else")
  })

  it("normalized operations never expose provider_reference, provider_status, or raw_provider_status to the caller", async () => {
    const adapter = fakeAdapter()
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const row = operationRow({
      provider_reference: "fake_ref_secret",
      provider_status: "internal_status",
      raw_provider_status: { sensitive: "payload" },
    })
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn().mockResolvedValue(row),
      listWalletOperations: vi.fn(),
    }))
    const { getWalletOperation } = await import("@/engine/wallet/walletOperations")
    const operation = await getWalletOperation("merchant-1", "op-1")
    expect(operation).not.toHaveProperty("provider_reference")
    expect(operation).not.toHaveProperty("providerReference")
    expect(operation).not.toHaveProperty("provider_status")
    expect(operation).not.toHaveProperty("providerStatus")
    expect(operation).not.toHaveProperty("raw_provider_status")
    expect(operation).not.toHaveProperty("rawProviderStatus")
    expect(JSON.stringify(operation)).not.toContain("fake_ref_secret")
    expect(JSON.stringify(operation)).not.toContain("sensitive")
  })

  it("normalizes abandoned CREATED withdrawals to INCOMPLETE for the wallet activity API", async () => {
    const adapter = fakeAdapter()
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const row = operationRow({
      status: "CREATED",
      created_at: "2000-01-01T00:00:00.000Z",
      updated_at: "2000-01-01T00:00:00.000Z",
      provider_reference: null,
      provider_transaction_id: null,
      submitted_at: null,
    })
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn().mockResolvedValue(row),
      listWalletOperations: vi.fn().mockResolvedValue({ operations: [row], nextCursor: null }),
    }))

    const { getWalletActivity, getWalletOperation } = await import("@/engine/wallet/walletOperations")
    const activity = await getWalletActivity("merchant-1", {})
    const operation = await getWalletOperation("merchant-1", "op-1")

    expect(activity.operations[0].status).toBe("INCOMPLETE")
    expect(operation.status).toBe("INCOMPLETE")
  })

  it("normalizes REQUIRES_ACTION to ACTION_REQUIRED for wallet operation display", async () => {
    const adapter = fakeAdapter()
    const resolveMerchantWalletProvider = vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext })
    const row = operationRow({ status: "REQUIRES_ACTION", failure_code: "STATUS_UNKNOWN" })
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({ resolveMerchantWalletProvider }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn().mockResolvedValue(row),
      listWalletOperations: vi.fn().mockResolvedValue({ operations: [row], nextCursor: null }),
    }))

    const { getWalletActivity } = await import("@/engine/wallet/walletOperations")
    const activity = await getWalletActivity("merchant-1", {})

    expect(activity.operations[0].status).toBe("ACTION_REQUIRED")
  })
})

describe("engine/wallet/walletOperations - getWalletCapabilities", () => {
  beforeEach(() => {
    vi.resetModules()
    // engine/wallet/walletOperations.ts imports these modules at the top
    // level even for capabilities-only tests - mock them so they never
    // reach the real Supabase client construction.
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({
      listWalletBalanceSnapshots: vi.fn().mockResolvedValue([]),
      upsertWalletBalanceSnapshot: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock("@/engine/wallet/walletProviderResolution")
    vi.doUnmock("@/database/merchantWalletOperations")
    vi.doUnmock("@/database/merchantWalletBalanceSnapshots")
  })

  it("reports every capability false and configured:false when no provider is resolved, never throwing", async () => {
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      tryResolveMerchantWalletProvider: vi.fn().mockResolvedValue(null),
    }))
    const { getWalletCapabilities } = await import("@/engine/wallet/walletOperations")
    const result = await getWalletCapabilities("merchant-1")
    expect(result.configured).toBe(false)
    expect(result.provider).toBeNull()
    for (const value of Object.values(result.capabilities)) {
      expect(value).toBe(false)
    }
  })

  it("adds activity:true unconditionally once a provider is ready, since it's PineTree's own ledger, not a provider capability", async () => {
    const adapter = fakeAdapter({
      provider: "fake-provider",
      providerDisplayName: "Fake Provider",
      getCapabilities: vi.fn().mockResolvedValue({
        balances: false,
        withdrawals: false,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      }),
    })
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      tryResolveMerchantWalletProvider: vi.fn().mockResolvedValue({ provider: "fake-provider", adapter, context: fakeContext }),
    }))
    const { getWalletCapabilities } = await import("@/engine/wallet/walletOperations")
    const result = await getWalletCapabilities("merchant-1")
    expect(result.configured).toBe(true)
    expect(result.provider).toBe("fake-provider")
    expect(result.providerDisplayName).toBe("Fake Provider")
    expect(result.capabilities.activity).toBe(true)
    expect(result.capabilities.balances).toBe(false)
  })
})

describe("engine/wallet/walletOperations - cached balance fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("@/engine/wallet/walletProviderResolution")
    vi.doUnmock("@/database/merchantWalletOperations")
    vi.doUnmock("@/database/merchantWalletBalanceSnapshots")
  })

  it("returns the last confirmed balance as stale when the live provider read fails", async () => {
    vi.resetModules()
    const adapter = fakeAdapter({
      getCapabilities: vi.fn().mockResolvedValue({
        balances: true,
        withdrawals: false,
        payouts: false,
        swaps: false,
        automaticPayouts: false,
        automaticConversion: false,
      }),
      getBalances: vi.fn().mockRejectedValue(new Error("provider timed out")),
    })
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      resolveMerchantWalletProvider: vi.fn().mockResolvedValue({
        provider: "fake-provider",
        adapter,
        context: fakeContext,
      }),
    }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
      listWalletOperations: vi.fn(),
    }))
    const upsertWalletBalanceSnapshot = vi.fn()
    const listWalletBalanceSnapshots = vi.fn().mockResolvedValue([{
      asset: "BTC",
      network: "bitcoin_lightning",
      available_base_units: "125000",
      pending_base_units: "0",
      total_base_units: "125000",
      provider_updated_at: "2026-07-17T12:00:00.000Z",
      cached_at: "2026-07-17T12:00:00.000Z",
    }])
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({
      upsertWalletBalanceSnapshot,
      listWalletBalanceSnapshots,
    }))

    const { getWalletBalances } = await import("@/engine/wallet/walletOperations")
    const result = await getWalletBalances("merchant-1")

    expect(result.syncStatus).toBe("cached")
    expect(result.unavailableReason).toBe("WALLET_PROVIDER_UNAVAILABLE")
    expect(result.lastSuccessfulSyncAt).toBe("2026-07-17T12:00:00.000Z")
    expect(result.balances[0]).toMatchObject({
      asset: "BTC",
      availableBaseUnits: "125000",
      stale: true,
    })
    expect(upsertWalletBalanceSnapshot).not.toHaveBeenCalled()
    expect(listWalletBalanceSnapshots).toHaveBeenCalledWith(
      "merchant-1",
      "fake-provider",
      fakeContext.providerAccountId
    )
  })
})
