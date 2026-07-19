import { afterEach, describe, expect, it, vi } from "vitest"
import type { WalletProviderAdapter } from "@/engine/wallet/walletProviderAdapter"

describe("wallet activity provider synchronization", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("@/engine/wallet/walletProviderResolution")
    vi.doUnmock("@/database/merchantWalletOperations")
    vi.doUnmock("@/database/merchantWalletBalanceSnapshots")
  })

  it("paginates, deduplicates overlapping pages, scopes writes, and stops at known history", async () => {
    const transaction = (id: string) => ({
      providerTransactionId: id,
      providerReference: `pi_${id}`,
      operationType: "PAYMENT" as const,
      direction: "credit" as const,
      status: "COMPLETED" as const,
      providerStatus: "Payment",
      asset: "SATS",
      network: "bitcoin_lightning",
      amountBaseUnits: BigInt(100),
      feeBaseUnits: BigInt(1),
      providerCreatedAt: "2026-07-19T00:00:00.000Z",
    })
    const listActivity = vi.fn()
      .mockResolvedValueOnce({ activity: [transaction("txn_1"), transaction("txn_1")], nextCursor: "txn_1" })
      .mockResolvedValueOnce({ activity: [transaction("txn_2")], nextCursor: "txn_2" })
    const adapter = {
      provider: "fake-provider",
      providerDisplayName: "Fake",
      resolveContext: vi.fn(),
      getCapabilities: vi.fn(),
      listActivity,
    } as WalletProviderAdapter
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      resolveMerchantWalletProvider: vi.fn().mockResolvedValue({
        provider: "fake-provider",
        adapter,
        context: { merchantId: "merchant-1", providerAccountId: "acct_1" },
      }),
    }))
    const upsertWalletOperationFromProviderActivity = vi.fn()
      .mockResolvedValueOnce({ operation: {}, created: true, transactionWasKnown: false })
      .mockResolvedValueOnce({ operation: {}, created: false, transactionWasKnown: true })
    const listWalletOperations = vi.fn().mockResolvedValue({ operations: [], nextCursor: null })
    vi.doMock("@/database/merchantWalletOperations", () => ({
      upsertWalletOperationFromProviderActivity,
      listWalletOperations,
      createWalletOperation: vi.fn(),
      updateWalletOperation: vi.fn(),
      getWalletOperationForMerchant: vi.fn(),
    }))
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({
      listWalletBalanceSnapshots: vi.fn(),
      upsertWalletBalanceSnapshot: vi.fn(),
    }))

    const { getWalletActivity } = await import("@/engine/wallet/walletOperations")
    await getWalletActivity("merchant-1", { limit: 25 })

    expect(listActivity).toHaveBeenNthCalledWith(1, expect.objectContaining({ providerAccountId: "acct_1" }), { cursor: null, limit: 100 })
    expect(listActivity).toHaveBeenNthCalledWith(2, expect.anything(), { cursor: "txn_1", limit: 100 })
    expect(upsertWalletOperationFromProviderActivity).toHaveBeenCalledTimes(2)
    expect(upsertWalletOperationFromProviderActivity).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: "merchant-1",
      provider: "fake-provider",
      providerAccountId: "acct_1",
    }))
    expect(listWalletOperations).toHaveBeenCalledWith(expect.objectContaining({ providerAccountId: "acct_1" }))
  })

  it("returns cached local activity when provider sync times out", async () => {
    const adapter = {
      provider: "fake-provider",
      providerDisplayName: "Fake",
      resolveContext: vi.fn(),
      getCapabilities: vi.fn(),
      listActivity: vi.fn().mockRejectedValue(new Error("timeout")),
    } as WalletProviderAdapter
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      resolveMerchantWalletProvider: vi.fn().mockResolvedValue({
        provider: "fake-provider", adapter,
        context: { merchantId: "merchant-1", providerAccountId: "acct_1" },
      }),
    }))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      upsertWalletOperationFromProviderActivity: vi.fn(),
      listWalletOperations: vi.fn().mockResolvedValue({ operations: [], nextCursor: null }),
      createWalletOperation: vi.fn(), updateWalletOperation: vi.fn(), getWalletOperationForMerchant: vi.fn(),
    }))
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({ listWalletBalanceSnapshots: vi.fn(), upsertWalletBalanceSnapshot: vi.fn() }))
    const { getWalletActivity } = await import("@/engine/wallet/walletOperations")
    await expect(getWalletActivity("merchant-1", {})).resolves.toEqual({ operations: [], nextCursor: null })
  })
})

describe("Speed operation-account migration", () => {
  it("uses account-scoped provider transaction identity without weakening RLS", async () => {
    const { readFileSync } = await import("fs")
    const sql = readFileSync("database/migrations/20260719_scope_speed_wallet_operations.sql", "utf8")
    expect(sql).toContain("provider_account_id")
    expect(sql).toContain("provider_transaction_id")
    expect(sql).toContain("provider_secondary_reference")
    expect(sql).toContain("provider, provider_account_id, provider_transaction_id")
    expect(sql).not.toMatch(/disable row level security|drop table|truncate/i)
  })
})
