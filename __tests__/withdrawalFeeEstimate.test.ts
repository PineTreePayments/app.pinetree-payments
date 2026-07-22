import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPineTreeWalletProfile: vi.fn(),
  getWalletBalance: vi.fn(),
  sumPendingWalletWithdrawalAmount: vi.fn(),
  sumPendingWithdrawalOperationBaseUnits: vi.fn(),
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/walletBalances", () => ({
  getWalletBalance: mocks.getWalletBalance,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  sumPendingWalletWithdrawalAmount: mocks.sumPendingWalletWithdrawalAmount,
}))

vi.mock("@/database/merchantWalletOperations", () => ({
  sumPendingWithdrawalOperationBaseUnits: mocks.sumPendingWithdrawalOperationBaseUnits,
}))

// Solana fee estimation talks to a real Connection - stub the whole module so
// tests never make network calls. Only the methods withdrawalFeeEstimate.ts
// actually calls are implemented.
vi.mock("@solana/web3.js", () => ({
  Connection: vi.fn().mockImplementation(() => ({
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "fake-blockhash" }),
    getAccountInfo: vi.fn().mockResolvedValue({}), // ATA already exists - no rent needed
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }),
    getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(2039280),
  })),
  PublicKey: vi.fn().mockImplementation((value: string) => ({ toString: () => value })),
  SystemProgram: { transfer: vi.fn().mockReturnValue({}) },
  Transaction: vi.fn().mockImplementation(() => ({
    feePayer: null,
    recentBlockhash: null,
    add: vi.fn(),
    compileMessage: vi.fn().mockReturnValue({}),
  })),
}))

vi.mock("@solana/spl-token", () => ({
  getAssociatedTokenAddress: vi.fn().mockResolvedValue("fake-ata"),
  createAssociatedTokenAccountInstruction: vi.fn().mockReturnValue({}),
  createTransferCheckedInstruction: vi.fn().mockReturnValue({}),
}))

import { estimateMaxWithdrawalAmount } from "@/engine/withdrawals/withdrawalFeeEstimate"
import { calculateSpeedMaximumSendableSats } from "@/engine/withdrawals/speedWithdrawalQuote"

const BASE_ETH_GAS_PRICE_WEI = "0x3b9aca00" // 1 gwei
const BASE_ETH_GAS_ESTIMATE = "0x5208" // 21000

function mockBaseFetch() {
  global.fetch = vi.fn().mockImplementation(async (_url, options) => {
    const body = JSON.parse((options as { body: string }).body)
    if (body.method === "eth_gasPrice") {
      return { json: async () => ({ result: BASE_ETH_GAS_PRICE_WEI }) }
    }
    if (body.method === "eth_estimateGas") {
      return { json: async () => ({ result: BASE_ETH_GAS_ESTIMATE }) }
    }
    return { json: async () => ({ result: "0x0" }) }
  }) as unknown as typeof fetch
}

describe("estimateMaxWithdrawalAmount", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBaseFetch()
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      base_address: "0x1111111111111111111111111111111111111a",
      solana_address: "So1anaAddress11111111111111111111111111111",
    })
    mocks.sumPendingWalletWithdrawalAmount.mockResolvedValue(0)
    mocks.sumPendingWithdrawalOperationBaseUnits.mockResolvedValue(BigInt(0))
    delete process.env.BTC_MAX_WITHDRAWAL_FEE_BUFFER_SATS
    delete process.env.SPEED_WITHDRAWAL_FEE_BUFFER_SATS
    delete process.env.SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS
    delete process.env.SPEED_ONCHAIN_WITHDRAWAL_FEE_BUFFER_SATS
  })

  it("Bitcoin: max = confirmed sats - pending - configured fee buffer", async () => {
    mocks.getWalletBalance.mockResolvedValue({ balance: "0.001" }) // 100,000 sats
    mocks.sumPendingWithdrawalOperationBaseUnits.mockResolvedValue(BigInt(10000))
    process.env.SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS = "500"

    const estimate = await estimateMaxWithdrawalAmount("merchant_1", "bitcoin", "BTC")

    // 100000 - 10000 pending - 500 buffer = 89500 sats = 0.000895 BTC
    expect(estimate.maxDecimal).toBe("0.000895")
    expect(estimate.feeAsset).toBe("BTC")
    expect(estimate.blocked).toBeUndefined()
  })

  it("Speed Bitcoin quote math leaves integer sats for provider/network fees", () => {
    process.env.SPEED_LIGHTNING_WITHDRAWAL_FEE_BUFFER_SATS = "500"

    const quote = calculateSpeedMaximumSendableSats({
      providerAvailableSats: BigInt(2969),
      pendingSats: BigInt(0),
      method: "lightning",
    })

    expect(quote.estimatedFeeSats).toBe(BigInt(500))
    expect(quote.maximumSendableSats).toBe(BigInt(2469))
  })

  it("Base ETH (native): subtracts pending, RPC fee estimate, and configured reserve", async () => {
    mocks.getWalletBalance.mockResolvedValue({ balance: "1" })
    process.env.BASE_ETH_MIN_RESERVE = "0.0003"
    process.env.WITHDRAWAL_FEE_SAFETY_MULTIPLIER = "1"

    const estimate = await estimateMaxWithdrawalAmount("merchant_1", "base", "ETH")

    // fee = 1 gwei * 21000 = 0.000021 ETH; reserve = 0.0003 ETH
    expect(estimate.maxDecimal).toBe("0.999679")
    expect(estimate.feeAsset).toBe("ETH")
    expect(estimate.blocked).toBeUndefined()
  })

  it("Base USDC: never subtracts gas from the token balance itself when ETH is sufficient", async () => {
    mocks.getWalletBalance.mockImplementation(async (_merchantId: string, key: string) => {
      if (key === "BASE_USDC") return { balance: "500" }
      if (key === "BASE_ETH") return { balance: "1" } // plenty of ETH for gas
      return null
    })

    const estimate = await estimateMaxWithdrawalAmount("merchant_1", "base", "USDC")

    expect(estimate.maxDecimal).toBe("500")
    expect(estimate.feeAsset).toBe("ETH")
    expect(estimate.blocked).toBeUndefined()
  })

  it("Base USDC: blocks with a clear message when ETH cannot cover the network fee - never silently subtracts from USDC", async () => {
    mocks.getWalletBalance.mockImplementation(async (_merchantId: string, key: string) => {
      if (key === "BASE_USDC") return { balance: "500" }
      if (key === "BASE_ETH") return { balance: "0" } // no ETH at all
      return null
    })

    const estimate = await estimateMaxWithdrawalAmount("merchant_1", "base", "USDC")

    expect(estimate.blocked).toBe(true)
    expect(estimate.maxDecimal).toBe("0")
    expect(estimate.warning).toBe(
      "This wallet does not currently have enough ETH on Base to cover the network fee for this USDC withdrawal."
    )
  })

  it("Solana USDC: blocks with a clear message when SOL cannot cover the network fee", async () => {
    mocks.getWalletBalance.mockImplementation(async (_merchantId: string, key: string) => {
      if (key === "SOLANA_USDC") return { balance: "500" }
      if (key === "SOLANA_SOL") return { balance: "0" }
      return null
    })

    const estimate = await estimateMaxWithdrawalAmount("merchant_1", "solana", "USDC")

    expect(estimate.blocked).toBe(true)
    expect(estimate.warning).toBe(
      "This wallet does not currently have enough SOL on Solana to cover the network fee for this USDC withdrawal."
    )
  })

  it("returns blocked when the wallet has no source address on file yet", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValue({ base_address: null, solana_address: null })
    mocks.getWalletBalance.mockResolvedValue({ balance: "1" })

    const estimate = await estimateMaxWithdrawalAmount("merchant_1", "base", "ETH")

    expect(estimate.blocked).toBe(true)
    expect(estimate.maxDecimal).toBe("0")
  })
})
