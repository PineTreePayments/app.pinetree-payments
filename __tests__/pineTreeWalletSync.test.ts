import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPineTreeWalletProfile: vi.fn(),
  getWalletBalances: vi.fn(),
  upsertMerchantAssetBalances: vi.fn(),
  fetchSolanaUsdcBalance: vi.fn(),
  fetchBaseUsdcBalance: vi.fn(),
  getMarketPricesUSD: vi.fn(),
  listRecentWalletWithdrawalsForActivity: vi.fn(),
  cancelStaleUnsignedWithdrawalReviews: vi.fn(),
  getMerchantProviders: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  getPineTreeSpeedConfigStatus: vi.fn(),
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/walletBalances", () => ({
  getWalletBalances: mocks.getWalletBalances,
}))

vi.mock("@/database/walletOverview", () => ({
  upsertMerchantAssetBalances: mocks.upsertMerchantAssetBalances,
}))

vi.mock("@/engine/settlementBalances", () => ({
  fetchSolanaUsdcBalance: mocks.fetchSolanaUsdcBalance,
  fetchBaseUsdcBalance: mocks.fetchBaseUsdcBalance,
}))

vi.mock("@/engine/marketPrices", () => ({
  getMarketPricesUSD: mocks.getMarketPricesUSD,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  listRecentWalletWithdrawalsForActivity: mocks.listRecentWalletWithdrawalsForActivity,
  cancelStaleUnsignedWithdrawalReviews: mocks.cancelStaleUnsignedWithdrawalReviews,
}))

vi.mock("@/database/merchants", () => ({
  getMerchantProviders: mocks.getMerchantProviders,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/providers/lightning/speedClient", () => ({
  getPineTreeSpeedConfigStatus: mocks.getPineTreeSpeedConfigStatus,
}))

import {
  getPineTreeWalletBalanceSnapshot,
  syncPineTreeWalletBalances,
} from "@/engine/pineTreeWalletSync"

describe("PineTree Wallet balance sync", () => {
  let storedRows: Array<{ id: string; merchant_id: string; asset: string; balance: number; last_updated: string }>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.BASE_RPC_URL
    storedRows = []

    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "profile_1",
      merchant_id: "merchant_1",
      base_address: "0x1234567890abcdef1234567890abcdef12345678",
      solana_address: "11111111111111111111111111111111",
      btc_address: null,
      bitcoin_onchain_address: null,
      bitcoin_lightning_address: null,
      status: "ready",
    })
    mocks.getWalletBalances.mockImplementation(async () => storedRows)
    mocks.upsertMerchantAssetBalances.mockImplementation(async (merchantId, balances, timestamp) => {
      for (const balance of balances) {
        storedRows = storedRows.filter((row) => row.asset !== balance.asset)
        storedRows.push({
          id: balance.asset,
          merchant_id: merchantId,
          asset: balance.asset,
          balance: balance.balance,
          last_updated: timestamp,
        })
      }
    })
    mocks.fetchSolanaUsdcBalance.mockResolvedValue(1.25)
    mocks.getMarketPricesUSD.mockResolvedValue({ SOL: 100, ETH: 2000, BTC: 60000 })
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([])
    mocks.cancelStaleUnsignedWithdrawalReviews.mockResolvedValue({ canceled: 0 })
    mocks.getMerchantProviders.mockResolvedValue([])
    mocks.getMerchantLightningProfile.mockResolvedValue(null)
    mocks.getPineTreeSpeedConfigStatus.mockReturnValue({ configured: true, missing: [] })
    global.fetch = vi.fn(async () => ({
      json: async () => ({ result: { value: 2_000_000_000 } }),
    })) as unknown as typeof fetch
  })

  it("parses Solana SOL balance, persists SOL and USDC, and returns synced shape", async () => {
    const result = await syncPineTreeWalletBalances("merchant_1")

    expect(mocks.upsertMerchantAssetBalances).toHaveBeenCalledWith(
      "merchant_1",
      expect.arrayContaining([
        { asset: "SOLANA_SOL", balance: 2 },
        { asset: "SOLANA_USDC", balance: 1.25 },
      ]),
      expect.any(String)
    )
    expect(result.balances.solana).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: "SOL", balance: 2, status: "synced" }),
        expect.objectContaining({ asset: "USDC", balance: 1.25, status: "synced" }),
      ])
    )
    expect(result.totalUsd).toBe(201.25)
    expect(result.lastSyncedAt).toEqual(expect.any(String))
  })

  it("returns pending_sync for Solana and config_missing for Base when BASE_RPC_URL is absent", async () => {
    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.totalUsd).toBeNull()
    expect(result.balances.base[0]).toMatchObject({ asset: "ETH", balance: null, status: "config_missing" })
    expect(result.balances.base[1]).toMatchObject({ asset: "USDC", balance: null, status: "config_missing" })
    expect(result.balances.solana[0]).toMatchObject({ asset: "SOL", balance: null, status: "pending_sync" })
  })

  it("Solana balances sync independently when BASE_RPC_URL is absent", async () => {
    const result = await syncPineTreeWalletBalances("merchant_1")

    // Solana still persisted
    expect(mocks.upsertMerchantAssetBalances).toHaveBeenCalledWith(
      "merchant_1",
      expect.arrayContaining([
        { asset: "SOLANA_SOL", balance: 2 },
        { asset: "SOLANA_USDC", balance: 1.25 },
      ]),
      expect.any(String)
    )
    // Base assets absent from upsert call
    const callArgs = mocks.upsertMerchantAssetBalances.mock.calls[0][1] as Array<{ asset: string }>
    const persistedAssets = callArgs.map((b) => b.asset)
    expect(persistedAssets).not.toContain("BASE_ETH")
    expect(persistedAssets).not.toContain("BASE_USDC")
    // Solana result is synced
    expect(result.balances.solana[0]).toMatchObject({ asset: "SOL", status: "synced" })
    // Base result is config_missing (no RPC URL)
    expect(result.balances.base[0]).toMatchObject({ asset: "ETH", status: "config_missing" })
  })

  it("Base balances sync when BASE_RPC_URL is present", async () => {
    process.env.BASE_RPC_URL = "https://base-rpc.example.com"
    mocks.fetchBaseUsdcBalance.mockResolvedValue(50)
    global.fetch = vi.fn(async () => ({
      json: async () => ({ result: "0x2386F26FC10000" }), // 0.01 ETH in hex
    })) as unknown as typeof fetch

    const result = await syncPineTreeWalletBalances("merchant_1")

    const callArgs = mocks.upsertMerchantAssetBalances.mock.calls[0][1] as Array<{ asset: string }>
    const persistedAssets = callArgs.map((b) => b.asset)
    expect(persistedAssets).toContain("BASE_ETH")
    expect(persistedAssets).toContain("BASE_USDC")
    expect(result.balances.base.some((b) => b.status === "synced")).toBe(true)
  })

  it("populates recentActivity from wallet withdrawal requests", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      {
        id: "wd-1",
        merchant_id: "merchant_1",
        rail: "solana",
        asset: "SOL",
        amount_decimal: "1.5",
        status: "confirmed",
        created_at: "2026-06-28T10:00:00Z",
        destination_address: "SomeAddress",
        tx_hash: "sol-tx-123",
      },
    ])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.recentActivity).toHaveLength(1)
    expect(result.recentActivity[0]).toMatchObject({
      id: "wd-1",
      status: "confirmed",
      createdAt: "2026-06-28T10:00:00Z",
    })
  })

  it("returns empty recentActivity when no withdrawals exist", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.recentActivity).toEqual([])
  })

  it("cleans stale unsigned reviews before loading activity", async () => {
    await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(mocks.cancelStaleUnsignedWithdrawalReviews).toHaveBeenCalledWith("merchant_1")
    expect(mocks.listRecentWalletWithdrawalsForActivity).toHaveBeenCalledWith("merchant_1", 10)
  })

  it("maps active unsigned reviews to Pending activity", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      {
        id: "wd-active",
        merchant_id: "merchant_1",
        rail: "base",
        asset: "USDC",
        amount_decimal: "5",
        status: "review_required",
        created_at: "2026-06-28T10:00:00Z",
        destination_address: "0x1234567890abcdef1234567890abcdef12345678",
        tx_hash: null,
      },
    ])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.recentActivity[0]).toMatchObject({
      id: "wd-active",
      status: "pending",
    })
  })

  it("a submitted withdrawal with a tx hash maps to Sent activity, not Pending", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      {
        id: "wd-sent",
        merchant_id: "merchant_1",
        rail: "solana",
        asset: "SOL",
        amount_decimal: "0.01",
        status: "processing",
        created_at: "2026-07-05T22:18:00Z",
        destination_address: "SomeAddress",
        tx_hash: "sol-tx-999",
      },
    ])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.recentActivity[0]).toMatchObject({
      id: "wd-sent",
      status: "sent",
      label: "Sent 0.01 SOL",
      rail: "solana",
    })
    expect(result.recentActivity[0].status).not.toBe("pending")
  })

  it("a withdrawal without a tx hash still shown as Pending even if status is oddly pending", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      {
        id: "wd-still-pending",
        merchant_id: "merchant_1",
        rail: "base",
        asset: "ETH",
        amount_decimal: "0.2",
        status: "pending",
        created_at: "2026-07-05T22:18:00Z",
        destination_address: "0x1234567890abcdef1234567890abcdef12345678",
        tx_hash: null,
      },
    ])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.recentActivity[0]).toMatchObject({
      id: "wd-still-pending",
      status: "pending",
    })
  })

  it("activity label is clean copy without the rail spelled out in parentheses", async () => {
    mocks.listRecentWalletWithdrawalsForActivity.mockResolvedValue([
      {
        id: "wd-label",
        merchant_id: "merchant_1",
        rail: "bitcoin",
        asset: "BTC",
        amount_decimal: "0.002",
        status: "confirmed",
        created_at: "2026-07-05T22:18:00Z",
        destination_address: "bc1qsomeaddress",
        tx_hash: "btc-tx-1",
      },
    ])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.recentActivity[0].label).toBe("Sent 0.002 BTC")
    expect(result.recentActivity[0].label).not.toContain("(")
    expect(result.recentActivity[0].label).not.toContain("Withdrawal:")
    expect(result.recentActivity[0].rail).toBe("bitcoin")
  })

  it("returns normalized provider-agnostic rail contract without stale BTC balances", async () => {
    storedRows = [
      {
        id: "btc-stale",
        merchant_id: "merchant_1",
        asset: "BTC",
        balance: 0.5,
        last_updated: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "base-usdc",
        merchant_id: "merchant_1",
        asset: "BASE_USDC",
        balance: 10,
        last_updated: "2026-07-01T00:00:00.000Z",
      },
    ]
    mocks.getMerchantLightningProfile.mockResolvedValue({
      status: "ready",
      speed_account_id: "acct_live_123",
      speed_connected_account_status: "Active",
    })
    mocks.getMerchantProviders.mockResolvedValue([
      { provider: "base", enabled: true, status: "connected" },
      { provider: "solana", enabled: true, status: "connected" },
      { provider: "lightning_speed", enabled: true, status: "connected" },
    ])

    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")
    const serialized = JSON.stringify(result.rails)

    expect(result.status).toBe("ready")
    expect(result.totalUsd).toBe(10)
    expect(result.total_balance_usd).toBe("10.00")
    expect(result.rails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rail: "bitcoin",
        display_name: "Bitcoin",
        connected: true,
        withdrawal_available: false,
        balance: {
          asset: "BTC",
          amount: null,
          usd_value: null,
          status: "unavailable",
        },
      }),
    ]))
    expect(result.balances.bitcoin[0]).toMatchObject({
      asset: "BTC",
      balance: null,
      usdValue: null,
      status: "unavailable",
    })
    expect(serialized).not.toContain("speed")
    expect(serialized).not.toContain("dynamic")
    expect(serialized).not.toContain("nwc")
    expect(serialized).not.toContain("provider")
  })
})
