import { beforeEach, describe, expect, it, vi } from "vitest"

describe("wallet withdrawal maintenance helper", () => {
  const afterMock = vi.fn()
  const reconcileProcessingWithdrawals = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock("next/server", () => ({
      after: afterMock,
    }))
    vi.doMock("@/engine/withdrawals/walletWithdrawalReconciliation", () => ({
      reconcileProcessingWithdrawals,
    }))
  })

  it("calls reconcileProcessingWithdrawals inside after()", async () => {
    reconcileProcessingWithdrawals.mockResolvedValueOnce({ checked: 0 })
    const { scheduleWalletWithdrawalMaintenance } = await import("@/lib/api/walletWithdrawalMaintenance")

    scheduleWalletWithdrawalMaintenance("test.trigger")

    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(reconcileProcessingWithdrawals).not.toHaveBeenCalled()

    const callback = afterMock.mock.calls[0][0] as () => Promise<void>
    await callback()

    expect(reconcileProcessingWithdrawals).toHaveBeenCalledWith({ limit: 10 })
  })

  it("catches and logs reconciliation errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    reconcileProcessingWithdrawals.mockRejectedValueOnce(new Error("rpc unavailable"))
    const { scheduleWalletWithdrawalMaintenance } = await import("@/lib/api/walletWithdrawalMaintenance")

    scheduleWalletWithdrawalMaintenance("test.trigger")
    const callback = afterMock.mock.calls[0][0] as () => Promise<void>

    await expect(callback()).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      "[wallet-withdrawal-maintenance] reconciliation failed",
      expect.objectContaining({
        trigger: "test.trigger",
        error: "rpc unavailable",
      })
    )

    warnSpy.mockRestore()
  })

  it("does not block the caller while reconciliation is pending", async () => {
    const neverSettles = new Promise(() => undefined)
    reconcileProcessingWithdrawals.mockReturnValueOnce(neverSettles)
    const { scheduleWalletWithdrawalMaintenance } = await import("@/lib/api/walletWithdrawalMaintenance")

    scheduleWalletWithdrawalMaintenance("test.trigger")

    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(reconcileProcessingWithdrawals).not.toHaveBeenCalled()
  })
})

describe("wallet withdrawal maintenance route triggers", () => {
  const requireMerchantIdFromRequest = vi.fn()
  const getRouteErrorStatus = vi.fn()
  const completeDynamicWalletWithdrawal = vi.fn()
  const syncPineTreeWalletBalances = vi.fn()
  const scheduleWalletWithdrawalMaintenance = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    requireMerchantIdFromRequest.mockResolvedValue("merchant_1")
    getRouteErrorStatus.mockReturnValue(500)
    completeDynamicWalletWithdrawal.mockResolvedValue({
      merchantStatus: "Processing",
      request: {
        id: "withdrawal_1",
        status: "processing",
        tx_hash: "0x1234",
      },
    })
    syncPineTreeWalletBalances.mockResolvedValue({
      totalUsd: 0,
      balances: { base: [], solana: [], bitcoin: [] },
      recentActivity: [],
      lastSyncedAt: "2026-06-30T00:00:00.000Z",
    })

    vi.doMock("@/lib/api/merchantAuth", () => ({
      requireMerchantIdFromRequest,
      getRouteErrorStatus,
    }))
    vi.doMock("@/engine/withdrawals/walletWithdrawals", () => ({
      completeDynamicWalletWithdrawal,
    }))
    vi.doMock("@/engine/pineTreeWalletSync", () => ({
      syncPineTreeWalletBalances,
    }))
    vi.doMock("@/lib/api/walletWithdrawalMaintenance", () => ({
      scheduleWalletWithdrawalMaintenance,
    }))
    vi.doMock("next/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/server")>()
      return {
        ...actual,
        after: vi.fn(),
      }
    })
  })

  it("submit route schedules withdrawal reconciliation after storing the tx hash", async () => {
    const { POST } = await import("@/app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route")
    const req = {
      json: async () => ({
        tx_hash: "0x1234",
        provider_reference: "dynamic_ref_1",
      }),
    }

    const response = await POST(req as never, { params: Promise.resolve({ id: "withdrawal_1" }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.merchantStatus).toBe("Processing")
    expect(completeDynamicWalletWithdrawal).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        txHash: "0x1234",
        providerReference: "dynamic_ref_1",
      })
    )
    expect(scheduleWalletWithdrawalMaintenance).toHaveBeenCalledWith("wallet-withdrawal.submit")
  })

  it("wallet sync route schedules withdrawal reconciliation after sync returns", async () => {
    const { POST } = await import("@/app/api/wallets/pinetree/sync/route")

    const response = await POST({} as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.lastSyncedAt).toBe("2026-06-30T00:00:00.000Z")
    expect(syncPineTreeWalletBalances).toHaveBeenCalledWith("merchant_1")
    expect(scheduleWalletWithdrawalMaintenance).toHaveBeenCalledWith("pinetree-wallet.sync")
  })
})
