import { afterEach, describe, expect, it, vi } from "vitest"
import { WalletApiRouteError } from "@/engine/wallet/walletErrors"
import type { WalletProviderAdapter } from "@/engine/wallet/walletProviderAdapter"

function operation(status = "CREATED") {
  return {
    id: "op-1", merchant_id: "merchant-1", provider: "speed", provider_account_id: "acct_1",
    operation_type: "WITHDRAWAL", direction: "debit", status, asset: "SATS", network: "bitcoin_lightning",
    amount_base_units: "1000", fee_base_units: null, destination_summary: "lnbc1...0000", tx_hash: null,
    explorer_url: null, provider_reference: null, provider_transaction_id: null, provider_secondary_reference: null,
    provider_created_at: null, provider_status: null, raw_provider_status: null, failure_code: null,
    failure_reason: null, idempotency_key: "key-1", created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z", completed_at: null,
  }
}

describe("account-scoped withdrawal safeguards", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock("@/engine/wallet/walletProviderResolution")
    vi.doUnmock("@/database/merchantWalletOperations")
    vi.doUnmock("@/database/merchantWalletBalanceSnapshots")
  })

  async function arrange(available: bigint, createWithdrawal = vi.fn()) {
    const adapter = {
      provider: "speed",
      providerDisplayName: "Speed",
      requiresFreshBalanceForWithdrawal: true,
      resolveContext: vi.fn(),
      validateWithdrawal: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        balances: true, withdrawals: true, payouts: false, swaps: false,
        automaticPayouts: false, automaticConversion: false,
      }),
      getBalances: vi.fn().mockResolvedValue([{ asset: "SATS", availableBaseUnits: available, pendingBaseUnits: BigInt(0), totalBaseUnits: available, network: "bitcoin_lightning", providerUpdatedAt: null }]),
      createWithdrawal,
    } as WalletProviderAdapter
    vi.doMock("@/engine/wallet/walletProviderResolution", () => ({
      resolveMerchantWalletProvider: vi.fn().mockResolvedValue({ provider: "speed", adapter, context: { merchantId: "merchant-1", providerAccountId: "acct_1" } }),
    }))
    const createWalletOperation = vi.fn().mockResolvedValue({ operation: operation(), created: true })
    const updateWalletOperation = vi.fn().mockImplementation(async (_merchant, _id, patch) => operation(patch.status || "CREATED"))
    vi.doMock("@/database/merchantWalletOperations", () => ({
      createWalletOperation,
      updateWalletOperation,
      getWalletOperationForMerchant: vi.fn(), listWalletOperations: vi.fn(),
      upsertWalletOperationFromProviderActivity: vi.fn(),
    }))
    vi.doMock("@/database/merchantWalletBalanceSnapshots", () => ({ listWalletBalanceSnapshots: vi.fn(), upsertWalletBalanceSnapshot: vi.fn() }))
    return { adapter, createWithdrawal, createWalletOperation, updateWalletOperation }
  }

  it("persists a failed operation and never dispatches when fresh balance is insufficient", async () => {
    const arranged = await arrange(BigInt(999))
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" })
    expect(arranged.createWithdrawal).not.toHaveBeenCalled()
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ status: "FAILED", failureCode: "INSUFFICIENT_BALANCE" }))
  })

  it("does not move an uncertain send timeout to PROCESSING without a provider reference", async () => {
    const createWithdrawal = vi.fn().mockRejectedValue(new WalletApiRouteError("WALLET_PROVIDER_TIMEOUT", "Provider timeout.", true))
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")
    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "WALLET_PROVIDER_TIMEOUT", retryable: true })
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({ status: "PROCESSING" })
    )
    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith("merchant-1", "op-1", expect.objectContaining({ status: "FAILED" }))
  })

  it("persists Speed provider identifiers and PROCESSING in the same successful write", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: "is_123",
      providerTransactionId: "is_123",
      providerSecondaryReference: "wi_123",
      providerStatus: "unpaid",
      providerCreatedAt: "2026-07-22T07:12:49.000Z",
      status: "PROCESSING",
      feeBaseUnits: BigInt(4),
      txHash: "tx_abc",
      explorerUrl: "https://mempool.space/tx/tx_abc",
      rawProviderStatus: { id: "is_123", withdraw_id: "wi_123", status: "unpaid" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })

    expect(arranged.updateWalletOperation).toHaveBeenCalledTimes(1)
    expect(arranged.updateWalletOperation).toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({
        status: "PROCESSING",
        providerReference: "is_123",
        providerTransactionId: "is_123",
        providerSecondaryReference: "wi_123",
        providerStatus: "unpaid",
        providerCreatedAt: "2026-07-22T07:12:49.000Z",
        submittedAt: expect.any(String),
        txHash: "tx_abc",
        explorerUrl: "https://mempool.space/tx/tx_abc",
        rawProviderStatus: expect.objectContaining({ id: "is_123", withdraw_id: "wi_123" }),
      })
    )
  })

  it("does not write PROCESSING when a provider result lacks any reconciliation identifier", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: null,
      providerTransactionId: null,
      providerSecondaryReference: null,
      providerStatus: "unpaid",
      status: "PROCESSING",
      rawProviderStatus: { status: "unpaid" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toMatchObject({ code: "STATUS_UNKNOWN", retryable: false })

    expect(arranged.updateWalletOperation).not.toHaveBeenCalledWith(
      "merchant-1",
      "op-1",
      expect.objectContaining({ status: "PROCESSING" })
    )
  })

  it("does not dispatch a duplicate withdrawal after provider acceptance when persistence fails", async () => {
    const createWithdrawal = vi.fn().mockResolvedValue({
      providerReference: "is_accepted",
      providerTransactionId: "is_accepted",
      providerSecondaryReference: "wi_accepted",
      providerStatus: "unpaid",
      status: "PROCESSING",
      rawProviderStatus: { id: "is_accepted", withdraw_id: "wi_accepted", status: "unpaid" },
    })
    const arranged = await arrange(BigInt(2000), createWithdrawal)
    arranged.updateWalletOperation.mockRejectedValueOnce(new Error("database unavailable"))
    arranged.createWalletOperation
      .mockResolvedValueOnce({ operation: operation(), created: true })
      .mockResolvedValueOnce({
        operation: { ...operation("CREATED"), destination_summary: "lnbc1q...qqqq" },
        created: false,
      })
    const { createWalletWithdrawal } = await import("@/engine/wallet/walletOperations")

    await expect(createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })).rejects.toThrow("database unavailable")
    const retry = await createWalletWithdrawal("merchant-1", {
      asset: "SATS", amountDecimal: "1000", destination: "lnbc1qqqqqqqqqqqqqqqqqqqq", idempotencyKey: "key-1",
    })

    expect(retry.operation.id).toBe("op-1")
    expect(createWithdrawal).toHaveBeenCalledTimes(1)
  })
})
