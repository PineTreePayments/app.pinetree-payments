import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WalletProviderAdapter } from "@/engine/wallet/walletProviderAdapter"

function operationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-1",
    merchant_id: "merchant-1",
    provider: "speed",
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
    provider_status: null,
    raw_provider_status: null,
    failure_code: null,
    failure_reason: null,
    idempotency_key: "key-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
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
    const existing = operationRow({ status: "FAILED", failure_code: "WALLET_CAPABILITY_UNAVAILABLE" })
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
