import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listRecentWalletOperationsForMerchant: vi.fn(),
  listSettlementWithdrawalsForMerchant: vi.fn(),
  listLightningPayoutJobsForMerchant: vi.fn(),
  listRecentWalletWithdrawalsForActivity: vi.fn(),
  getMerchantWalletRows: vi.fn(),
  getMerchantAssetBalances: vi.fn(),
  upsertMerchantAssetBalances: vi.fn(),
  setSystemLastRun: vi.fn(),
  getSystemLastRun: vi.fn(),
  getMarketPricesUSD: vi.fn(),
  getMerchantNwcStatus: vi.fn(),
  getMerchantSpeedProvider: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
  isSpeedPlatformTreasurySweepEnabled: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/database/walletOperations", () => ({
  listRecentWalletOperationsForMerchant: mocks.listRecentWalletOperationsForMerchant,
}))

vi.mock("@/database/settlementWithdrawals", () => ({
  listSettlementWithdrawalsForMerchant: mocks.listSettlementWithdrawalsForMerchant,
}))

vi.mock("@/database/lightningPayoutJobs", () => ({
  listLightningPayoutJobsForMerchant: mocks.listLightningPayoutJobsForMerchant,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  listRecentWalletWithdrawalsForActivity: mocks.listRecentWalletWithdrawalsForActivity,
}))

vi.mock("@/database", () => ({
  getMerchantWalletRows: mocks.getMerchantWalletRows,
  getMerchantAssetBalances: mocks.getMerchantAssetBalances,
  upsertMerchantAssetBalances: mocks.upsertMerchantAssetBalances,
  setSystemLastRun: mocks.setSystemLastRun,
  getSystemLastRun: mocks.getSystemLastRun,
}))

vi.mock("@/engine/marketPrices", () => ({
  getMarketPricesUSD: mocks.getMarketPricesUSD,
}))

vi.mock("@/database/merchantProviders", () => ({
  getMerchantNwcStatus: mocks.getMerchantNwcStatus,
  getMerchantSpeedProvider: mocks.getMerchantSpeedProvider,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
  isSpeedPlatformTreasurySweepEnabled: mocks.isSpeedPlatformTreasurySweepEnabled,
}))

vi.stubGlobal("fetch", mocks.fetch)

import { getWalletOverviewEngine, refreshWalletBalancesEngine } from "@/engine/walletOverview"

function makeWithdrawalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "wd-001",
    merchant_id: "merch-001",
    rail: "solana",
    asset: "SOL",
    amount_decimal: "2.5",
    destination_address: "SomeAddress",
    status: "confirmed",
    provider: "dynamic",
    provider_reference: null,
    tx_hash: "sol-tx-abc",
    unsigned_transaction_payload: null,
    signed_payload: null,
    approval_method: "dynamic_browser",
    chain_id: null,
    token_contract: null,
    token_mint: null,
    review_payload: {},
    error_message: null,
    wallet_profile_id: null,
    created_at: "2026-06-28T10:00:00Z",
    updated_at: "2026-06-28T10:05:00Z",
    ...overrides,
  }
}

describe("walletOverview listRecentWalletActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRecentWalletOperationsForMerchant.mockResolvedValue([])
    mocks.listSettlementWithdrawalsForMerchant.mockResolvedValue([])
    mocks.listLightningPayoutJobsForMerchant.mockResolvedValue([])
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([])
    mocks.getMerchantWalletRows.mockResolvedValue([])
    mocks.getMerchantAssetBalances.mockResolvedValue([])
    mocks.getSystemLastRun.mockResolvedValue(null)
    mocks.getMarketPricesUSD.mockResolvedValue({ SOL: 100, ETH: 2000, BTC: 60000 })
    mocks.getMerchantNwcStatus.mockResolvedValue(null)
    mocks.getMerchantSpeedProvider.mockResolvedValue(null)
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.fetch.mockResolvedValue({
      json: async () => ({ result: "0x0" }),
    })
  })

  it("includes completed PineTree withdrawals in recentOperations", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      makeWithdrawalRecord({ id: "wd-001", status: "confirmed" }),
    ])

    const result = await getWalletOverviewEngine("merch-001")

    const withdrawalOp = result.recentOperations.find((op) => op.id === "wd-001")
    expect(withdrawalOp).toBeDefined()
    expect(withdrawalOp?.operationType).toBe("PINETREE_WITHDRAWAL")
    expect(withdrawalOp?.status).toBe("CONFIRMED")
    expect(withdrawalOp?.asset).toBe("SOL")
  })

  it("includes failed PineTree withdrawals in recentOperations", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      makeWithdrawalRecord({ id: "wd-002", status: "failed", error_message: "insufficient funds" }),
    ])

    const result = await getWalletOverviewEngine("merch-001")

    const withdrawalOp = result.recentOperations.find((op) => op.id === "wd-002")
    expect(withdrawalOp).toBeDefined()
    expect(withdrawalOp?.status).toBe("FAILED")
    expect(withdrawalOp?.errorCode).toBe("WITHDRAWAL_FAILED")
    expect(withdrawalOp?.errorMessage).toBe("insufficient funds")
  })

  it("does not duplicate entries when both wallet_operations and wallet_withdrawal_requests are non-empty", async () => {
    mocks.listRecentWalletOperationsForMerchant.mockResolvedValue([
      {
        id: "op-001",
        operation_type: "SEND_CRYPTO",
        asset: "SOL",
        network: "solana",
        amount: 1,
        destination_type: "address",
        destination_value: "SomeAddr",
        status: "COMPLETED",
        provider: "phantom",
        provider_operation_id: null,
        provider_status: null,
        error_code: null,
        error_message: null,
        created_at: "2026-06-27T09:00:00Z",
        updated_at: "2026-06-27T09:01:00Z",
      },
    ])
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      makeWithdrawalRecord({ id: "wd-001", status: "confirmed" }),
    ])

    const result = await getWalletOverviewEngine("merch-001")

    const ids = result.recentOperations.map((op) => op.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
    expect(ids).toContain("op-001")
    expect(ids).toContain("wd-001")
  })

  it("orders recentOperations newest first across all sources", async () => {
    mocks.listSettlementWithdrawalsForMerchant.mockResolvedValue([
      {
        id: "sw-001",
        movement_type: "direct_send",
        asset: "ETH",
        network: "base",
        amount: 0.1,
        destination_kind: "address",
        destination_address: "0x123",
        tx_hash: "0xabc",
        status: "COMPLETED",
        failure_reason: null,
        created_at: "2026-06-26T08:00:00Z",
        updated_at: "2026-06-26T08:01:00Z",
      },
    ])
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      makeWithdrawalRecord({ id: "wd-newer", status: "confirmed", created_at: "2026-06-28T10:00:00Z" }),
    ])

    const result = await getWalletOverviewEngine("merch-001")

    const ids = result.recentOperations.map((op) => op.id)
    expect(ids.indexOf("wd-newer")).toBeLessThan(ids.indexOf("sw-001"))
  })

  it("returns at most 8 entries total even when all sources have records", async () => {
    const withdrawals = Array.from({ length: 25 }, (_, i) =>
      makeWithdrawalRecord({ id: `wd-${i}`, created_at: `2026-06-28T${String(i).padStart(2, "0")}:00:00Z` })
    )
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue(withdrawals)

    const result = await getWalletOverviewEngine("merch-001")

    expect(result.recentOperations.length).toBeLessThanOrEqual(8)
  })

  it("gracefully handles withdrawal DB failure without breaking the overview", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockRejectedValue(new Error("DB timeout"))

    const result = await getWalletOverviewEngine("merch-001")

    expect(result).toBeDefined()
    expect(result.recentOperations).toEqual([])
  })
})

describe("walletOverview Bitcoin balance ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRecentWalletOperationsForMerchant.mockResolvedValue([])
    mocks.listSettlementWithdrawalsForMerchant.mockResolvedValue([])
    mocks.listLightningPayoutJobsForMerchant.mockResolvedValue([])
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([])
    mocks.getMerchantWalletRows.mockResolvedValue([])
    mocks.getSystemLastRun.mockResolvedValue(null)
    mocks.getMarketPricesUSD.mockResolvedValue({ SOL: 100, ETH: 2000, BTC: 60000 })
    mocks.isSpeedPlatformTreasurySweepEnabled.mockReturnValue(false)
    mocks.setSystemLastRun.mockResolvedValue(undefined)
  })

  it("refreshWalletBalancesEngine (the function every Base/Solana save and rail-sync calls) never writes a BTC row - engine/pineTreeWalletSync.ts is the sole writer", async () => {
    mocks.getMerchantAssetBalances.mockResolvedValue([
      { asset: "BTC", balance: "0.00001596" },
    ])
    mocks.getMerchantSpeedProvider.mockResolvedValue({
      accountId: "acct_live_123",
      accountStatus: "active",
      providerRowId: "row-1",
    })
    mocks.getMerchantNwcStatus.mockResolvedValue(null)
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)

    await refreshWalletBalancesEngine("merch-001")

    const upsertedAssets = mocks.upsertMerchantAssetBalances.mock.calls.flatMap(
      (call) => (call[1] as Array<{ asset: string }>).map((b) => b.asset)
    )
    expect(upsertedAssets).not.toContain("BTC")
  })

  it("reads (never recomputes) the real persisted Speed BTC balance for the payment rail - a Dynamic BTC address is not required", async () => {
    mocks.getMerchantAssetBalances.mockResolvedValue([
      { asset: "BTC", balance: "0.00001596" },
    ])
    mocks.getMerchantSpeedProvider.mockResolvedValue({
      accountId: "acct_live_123",
      accountStatus: "active",
      providerRowId: "row-1",
    })
    mocks.getMerchantNwcStatus.mockResolvedValue(null)
    // No Dynamic-created Bitcoin wallet profile at all.
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)

    const result = await getWalletOverviewEngine("merch-001")
    const btcRail = result.paymentRails.find((rail) => rail.assetSymbol === "BTC")

    expect(btcRail).toMatchObject({
      provider: "Speed",
      status: "Connected",
      nativeBalance: 0.00001596,
      usdValue: 0.00001596 * 60000,
    })
  })

  it("never hardcodes the Bitcoin payment rail balance to zero when a real balance is persisted", async () => {
    mocks.getMerchantAssetBalances.mockResolvedValue([{ asset: "BTC", balance: "0.5" }])
    mocks.getMerchantSpeedProvider.mockResolvedValue({
      accountId: "acct_live_123",
      accountStatus: "active",
      providerRowId: "row-1",
    })
    mocks.getMerchantNwcStatus.mockResolvedValue(null)
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)

    const result = await getWalletOverviewEngine("merch-001")
    const btcRail = result.paymentRails.find((rail) => rail.assetSymbol === "BTC")

    expect(btcRail?.nativeBalance).not.toBe(0)
    expect(btcRail?.nativeBalance).toBe(0.5)
  })
})
