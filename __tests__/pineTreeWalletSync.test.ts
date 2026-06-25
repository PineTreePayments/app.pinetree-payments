import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPineTreeWalletProfile: vi.fn(),
  getWalletBalances: vi.fn(),
  upsertMerchantAssetBalances: vi.fn(),
  fetchSolanaUsdcBalance: vi.fn(),
  fetchBaseUsdcBalance: vi.fn(),
  getMarketPricesUSD: vi.fn(),
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

  it("returns pending sync for unsynced balances instead of fake zero", async () => {
    const result = await getPineTreeWalletBalanceSnapshot("merchant_1")

    expect(result.totalUsd).toBeNull()
    expect(result.balances.base[0]).toMatchObject({ asset: "ETH", balance: null, status: "pending_sync" })
    expect(result.balances.solana[0]).toMatchObject({ asset: "SOL", balance: null, status: "pending_sync" })
  })
})
